# BTC Chord Recognition API Server

High-accuracy chord recognition using the BTC (Bi-directional Transformer for Chord) model.

## Features

- **170 chord types** including:
  - Major/Minor triads (C, Cm, D, Dm, etc.)
  - Seventh chords (C7, Cmaj7, Cm7, Cdim7, etc.)
  - Extended chords (Caug, Cdim, Csus2, Csus4, etc.)
- **~82% accuracy** on MIREX benchmark
- **Cross-platform** support (Mac Intel/M1/M2/M3, Linux, Windows)
- **REST API** for easy integration

## Quick Start

### 1. Install Dependencies

```bash
cd server

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Start the Server

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server will be available at `http://localhost:8000`

### 3. Test the API

```bash
# Health check
curl http://localhost:8000/health

# List supported chords
curl http://localhost:8000/chords

# Analyze an audio file
curl -X POST -F "file=@your_audio.mp3" http://localhost:8000/analyze
```

## API Endpoints

### `GET /`
API information and available endpoints.

### `GET /health`
Health check - returns server status and model loading state.

### `GET /chords`
List all 170 supported chord types, organized by root note.

### `POST /analyze`
Analyze an audio file for chord detection.

**Parameters:**
- `file`: Audio file (MP3, WAV, FLAC, OGG, M4A, AAC)
- `min_duration`: Minimum chord duration in seconds (default: 0.3)

**Response:**
```json
{
  "success": true,
  "duration": 180.5,
  "num_chords": 45,
  "vocabulary_size": 170,
  "chords": [
    {
      "start": 0.0,
      "end": 2.5,
      "chord": "C:maj",
      "duration": 2.5
    },
    {
      "start": 2.5,
      "end": 5.0,
      "chord": "G:maj",
      "duration": 2.5
    }
  ],
  "message": "Successfully analyzed 180.5 seconds of audio"
}
```

### `POST /analyze/url`
Analyze audio from a direct URL (not YouTube).

**Parameters:**
- `url`: Direct URL to audio file
- `min_duration`: Minimum chord duration in seconds (default: 0.3)

## Supported Chord Types

The BTC model recognizes 170 chord types:

| Category | Examples |
|----------|----------|
| Major | C, D, E, F, G, A, B |
| Minor | Cm, Dm, Em, Fm, Gm, Am, Bm |
| Dominant 7th | C7, D7, E7, F7, G7, A7, B7 |
| Major 7th | Cmaj7, Dmaj7, Emaj7, ... |
| Minor 7th | Cm7, Dm7, Em7, ... |
| Diminished | Cdim, Ddim, ... |
| Augmented | Caug, Daug, ... |
| Diminished 7th | Cdim7, Ddim7, ... |
| Half-diminished | Cm7b5, Dm7b5, ... |
| Minor-Major 7th | CmM7, DmM7, ... |
| Suspended 2nd | Csus2, Dsus2, ... |
| Suspended 4th | Csus4, Dsus4, ... |
| Major 6th | C6, D6, ... |
| Minor 6th | Cm6, Dm6, ... |

## Mac M1/M2/M3 Support

The server automatically uses Apple's Metal Performance Shaders (MPS) for GPU acceleration on Apple Silicon Macs.

No additional configuration is needed - just run the server and it will detect and use MPS automatically.

## Integration with Web Frontend

The web frontend automatically detects the BTC API server. If the server is running at `http://localhost:8000`, the frontend will use it for chord analysis.

If the server is not available, the frontend falls back to browser-based chromagram analysis (lower accuracy, fewer chord types).

## Model Information

- **Model**: BTC (Bi-directional Transformer for Chord recognition)
- **Paper**: [A Bi-Directional Transformer for Musical Chord Recognition (ISMIR 2019)](https://archives.ismir.net/ismir2019/paper/000075.pdf)
- **Input**: Constant-Q Transform (CQT) spectrogram
- **Output**: 170 chord labels
- **Accuracy**: ~82% on MIREX benchmark

## Troubleshooting

### Model loading error
Make sure the model files exist in `server/btc/`:
- `btc_model_large_voca.pt` (12MB)
- `btc_model.pt` (12MB)

### CORS issues
The server is configured to allow all origins by default. If you need to restrict this, modify the CORS settings in `main.py`.

### Memory issues
For very long audio files (>30 minutes), consider:
1. Splitting the file into smaller segments
2. Increasing system memory
3. Using CPU instead of GPU (set `device = torch.device("cpu")`)
