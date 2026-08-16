# AAC to YouTube Converter

A simple tool to convert AAC audio files to MP3 format, making them compatible with YouTube uploads.

## Features

- Converts AAC audio files to MP3 (192 kbps, 44.1 kHz)
- YouTube-compatible audio format
- Fast conversion with ffmpeg
- Preserves audio quality

## Requirements

- ffmpeg (install with: `apt-get install ffmpeg`)

## Usage

```bash
./aac-to-youtube.sh <input.aac> [output.mp3]
```

### Examples

Convert with automatic output naming:
```bash
./aac-to-youtube.sh voice_173243.aac
# Creates: voice_173243.mp3
```

Specify custom output filename:
```bash
./aac-to-youtube.sh input.aac my_audio.mp3
```

## Output Specifications

- **Format:** MP3 (MPEG-3)
- **Bitrate:** 192 kbps
- **Sample Rate:** 44.1 kHz
- **Channels:** Preserved from source (mono or stereo)

## YouTube Upload

The generated MP3 file can be directly uploaded to YouTube:
1. Go to YouTube Studio
2. Select "Create" → "Upload Video"
3. Upload the .mp3 file (audio-only)
4. Add title, description, and thumbnail
5. Publish

YouTube accepts audio-only MP3 files and will create a video with a static image or album art.

## Files

- `aac-to-youtube.sh` - Main conversion script
- `voice_173243.mp3` - Example output (converted from voice_173243.aac)
