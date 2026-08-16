#!/bin/bash

# AAC to YouTube Format Converter
# Converts AAC audio files to MP3 format compatible with YouTube

if [ $# -eq 0 ]; then
    echo "Usage: $0 <input.aac> [output.mp3]"
    echo ""
    echo "Converts AAC audio files to MP3 format (YouTube compatible)"
    echo "If output file is not specified, it will be derived from input filename"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="${2:-${INPUT_FILE%.aac}.mp3}"

if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file '$INPUT_FILE' not found"
    exit 1
fi

echo "Converting AAC to MP3 for YouTube..."
echo "Input:  $INPUT_FILE"
echo "Output: $OUTPUT_FILE"
echo ""

ffmpeg -i "$INPUT_FILE" -b:a 192k "$OUTPUT_FILE" -y

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Conversion successful!"
    echo "Output file: $OUTPUT_FILE"
    ls -lh "$OUTPUT_FILE"
else
    echo ""
    echo "✗ Conversion failed!"
    exit 1
fi
