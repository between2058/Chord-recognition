"""
BTC Chord Recognition API Server

A FastAPI server that uses the BTC (Bi-directional Transformer for Chord recognition)
model to analyze audio files and return chord progressions.

Supports 170 chord types including:
- Major/Minor triads (C, Cm, D, Dm, etc.)
- Seventh chords (C7, Cmaj7, Cm7, etc.)
- Diminished/Augmented (Cdim, Caug, etc.)
- Suspended chords (Csus2, Csus4, etc.)
"""

import os
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Optional
import uuid

import numpy as np
import torch
import librosa
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

warnings.filterwarnings('ignore')

# Add btc module to path
BTC_DIR = Path(__file__).parent / "btc"
sys.path.insert(0, str(BTC_DIR))

from btc.btc_model import BTC_model
from btc.utils.hparams import HParams
from btc.utils.mir_eval_modules import idx2chord, idx2voca_chord

# Initialize FastAPI app
app = FastAPI(
    title="BTC Chord Recognition API",
    description="Analyze audio files to detect chord progressions using BTC Transformer model",
    version="1.0.0"
)

# Enable CORS for web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChordSegment(BaseModel):
    """A single chord segment with timing information"""
    start: float
    end: float
    chord: str
    duration: float


class ChordAnalysisResponse(BaseModel):
    """Response containing the full chord analysis"""
    success: bool
    duration: float
    num_chords: int
    vocabulary_size: int
    chords: list[ChordSegment]
    message: Optional[str] = None


class ModelManager:
    """Manages BTC model loading and inference"""

    def __init__(self):
        self.model = None
        self.config = None
        self.mean = None
        self.std = None
        self.device = None
        self.idx_to_chord = None
        self.large_voca = True  # Use 170 chord vocabulary by default

    def load_model(self):
        """Load the BTC model and weights"""
        if self.model is not None:
            return

        print("Loading BTC model...")

        # Determine device
        if torch.cuda.is_available():
            self.device = torch.device("cuda")
            print("Using CUDA GPU")
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            self.device = torch.device("mps")
            print("Using Apple Metal GPU (MPS)")
        else:
            self.device = torch.device("cpu")
            print("Using CPU")

        # Load config
        config_path = BTC_DIR / "run_config.yaml"
        self.config = HParams.load(str(config_path))

        # Set large vocabulary mode
        if self.large_voca:
            self.config.feature['large_voca'] = True
            self.config.model['num_chords'] = 170
            model_file = BTC_DIR / "btc_model_large_voca.pt"
            self.idx_to_chord = idx2voca_chord()
            print("Using large vocabulary (170 chords)")
        else:
            model_file = BTC_DIR / "btc_model.pt"
            self.idx_to_chord = {i: c for i, c in enumerate(idx2chord)}
            print("Using small vocabulary (25 chords)")

        # Initialize model
        self.model = BTC_model(config=self.config.model).to(self.device)

        # Load weights
        if model_file.exists():
            checkpoint = torch.load(str(model_file), map_location=self.device)
            self.mean = checkpoint['mean']
            self.std = checkpoint['std']
            self.model.load_state_dict(checkpoint['model'])
            print(f"Model loaded from {model_file}")
        else:
            raise FileNotFoundError(f"Model file not found: {model_file}")

        self.model.eval()
        print("BTC model ready!")

    def audio_to_features(self, audio_path: str):
        """Convert audio file to CQT features"""
        config = self.config

        # Load audio
        original_wav, sr = librosa.load(
            audio_path,
            sr=config.mp3['song_hz'],
            mono=True
        )

        # Compute CQT features in chunks
        current_sec_hz = 0
        feature = None
        chunk_samples = int(config.mp3['song_hz'] * config.mp3['inst_len'])

        while len(original_wav) > current_sec_hz + chunk_samples:
            start_idx = int(current_sec_hz)
            end_idx = int(current_sec_hz + chunk_samples)

            tmp = librosa.cqt(
                original_wav[start_idx:end_idx],
                sr=sr,
                n_bins=config.feature['n_bins'],
                bins_per_octave=config.feature['bins_per_octave'],
                hop_length=config.feature['hop_length']
            )

            if feature is None:
                feature = tmp
            else:
                feature = np.concatenate((feature, tmp), axis=1)

            current_sec_hz = end_idx

        # Process remaining audio
        if current_sec_hz < len(original_wav):
            tmp = librosa.cqt(
                original_wav[current_sec_hz:],
                sr=sr,
                n_bins=config.feature['n_bins'],
                bins_per_octave=config.feature['bins_per_octave'],
                hop_length=config.feature['hop_length']
            )
            if feature is None:
                feature = tmp
            else:
                feature = np.concatenate((feature, tmp), axis=1)

        # Log magnitude
        feature = np.log(np.abs(feature) + 1e-6)

        feature_per_second = config.mp3['inst_len'] / config.model['timestep']
        song_length_second = len(original_wav) / config.mp3['song_hz']

        return feature, feature_per_second, song_length_second

    def analyze(self, audio_path: str) -> list[ChordSegment]:
        """Analyze audio and return chord segments"""
        if self.model is None:
            self.load_model()

        # Extract features
        feature, feature_per_second, song_length = self.audio_to_features(audio_path)

        # Preprocess
        feature = feature.T
        feature = (feature - self.mean) / self.std

        time_unit = feature_per_second
        n_timestep = self.config.model['timestep']

        # Pad to multiple of timestep
        num_pad = n_timestep - (feature.shape[0] % n_timestep)
        if num_pad < n_timestep:
            feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant", constant_values=0)

        num_instance = feature.shape[0] // n_timestep

        # Run inference
        segments = []
        start_time = 0.0
        prev_chord = None

        with torch.no_grad():
            feature_tensor = torch.tensor(feature, dtype=torch.float32).unsqueeze(0).to(self.device)

            for t in range(num_instance):
                chunk = feature_tensor[:, n_timestep * t:n_timestep * (t + 1), :]
                encoder_output, _ = self.model.self_attn_layers(chunk)
                prediction, _ = self.model.output_layer(encoder_output)
                prediction = prediction.squeeze()

                for i in range(n_timestep):
                    current_time = time_unit * (n_timestep * t + i)
                    chord_idx = prediction[i].item()

                    if prev_chord is None:
                        prev_chord = chord_idx
                        continue

                    if chord_idx != prev_chord:
                        # Save previous segment
                        chord_name = self.idx_to_chord[prev_chord]
                        segments.append(ChordSegment(
                            start=round(start_time, 3),
                            end=round(current_time, 3),
                            chord=chord_name,
                            duration=round(current_time - start_time, 3)
                        ))
                        start_time = current_time
                        prev_chord = chord_idx

                    # Handle end of audio
                    if t == num_instance - 1 and i + num_pad == n_timestep:
                        if start_time != current_time:
                            chord_name = self.idx_to_chord[prev_chord]
                            segments.append(ChordSegment(
                                start=round(start_time, 3),
                                end=round(current_time, 3),
                                chord=chord_name,
                                duration=round(current_time - start_time, 3)
                            ))
                        break

        return segments, song_length


# Global model manager
model_manager = ModelManager()


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    try:
        model_manager.load_model()
    except Exception as e:
        print(f"Warning: Could not load model on startup: {e}")
        print("Model will be loaded on first request")


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "name": "BTC Chord Recognition API",
        "version": "1.0.0",
        "status": "ready" if model_manager.model is not None else "model_not_loaded",
        "vocabulary_size": 170 if model_manager.large_voca else 25,
        "endpoints": {
            "/analyze": "POST - Analyze audio file for chord detection",
            "/health": "GET - Health check",
            "/chords": "GET - List all supported chord types"
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": model_manager.model is not None,
        "device": str(model_manager.device) if model_manager.device else "not_initialized"
    }


@app.get("/chords")
async def list_chords():
    """List all supported chord types"""
    if model_manager.idx_to_chord is None:
        # Generate chord list without loading model
        chord_list = idx2voca_chord()
    else:
        chord_list = model_manager.idx_to_chord

    # Organize by root note
    organized = {}
    for idx, chord in chord_list.items():
        if chord in ['N', 'X']:
            continue
        root = chord.split(':')[0] if ':' in chord else chord
        if root not in organized:
            organized[root] = []
        organized[root].append(chord)

    return {
        "total": len(chord_list),
        "by_root": organized
    }


@app.post("/analyze", response_model=ChordAnalysisResponse)
async def analyze_audio(
    file: UploadFile = File(..., description="Audio file (MP3, WAV, etc.)"),
    min_duration: float = Query(0.3, description="Minimum chord duration in seconds")
):
    """
    Analyze an audio file and return detected chord progressions.

    Supports: MP3, WAV, FLAC, OGG, and other formats supported by librosa.

    Returns chord segments with start time, end time, chord name, and duration.
    """
    # Validate file type
    allowed_extensions = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'}
    file_ext = Path(file.filename).suffix.lower() if file.filename else ''

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Supported: {', '.join(allowed_extensions)}"
        )

    # Save uploaded file temporarily
    temp_dir = tempfile.gettempdir()
    temp_filename = f"chord_analysis_{uuid.uuid4().hex}{file_ext}"
    temp_path = os.path.join(temp_dir, temp_filename)

    try:
        # Write uploaded file
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Analyze
        segments, duration = model_manager.analyze(temp_path)

        # Filter by minimum duration
        if min_duration > 0:
            segments = [s for s in segments if s.duration >= min_duration]

        return ChordAnalysisResponse(
            success=True,
            duration=round(duration, 3),
            num_chords=len(segments),
            vocabulary_size=170 if model_manager.large_voca else 25,
            chords=segments,
            message=f"Successfully analyzed {duration:.1f} seconds of audio"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/analyze/url")
async def analyze_from_url(
    url: str = Query(..., description="URL of the audio file"),
    min_duration: float = Query(0.3, description="Minimum chord duration in seconds")
):
    """
    Analyze audio from a URL (e.g., direct link to MP3 file).

    Note: This does NOT support YouTube URLs directly.
    For YouTube, use the web frontend which handles video extraction.
    """
    import urllib.request

    # Download audio
    temp_dir = tempfile.gettempdir()
    temp_filename = f"chord_analysis_{uuid.uuid4().hex}.mp3"
    temp_path = os.path.join(temp_dir, temp_filename)

    try:
        urllib.request.urlretrieve(url, temp_path)

        # Analyze
        segments, duration = model_manager.analyze(temp_path)

        # Filter by minimum duration
        if min_duration > 0:
            segments = [s for s in segments if s.duration >= min_duration]

        return ChordAnalysisResponse(
            success=True,
            duration=round(duration, 3),
            num_chords=len(segments),
            vocabulary_size=170 if model_manager.large_voca else 25,
            chords=segments,
            message=f"Successfully analyzed {duration:.1f} seconds of audio from URL"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
