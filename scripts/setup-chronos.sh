#!/usr/bin/env bash
set -e

echo "Setting up Amazon Chronos environment..."

# Check if python3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Python3 is not installed. Please install Python3 first."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment '.venv'..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "Installing PyTorch, Transformers, Chronos-Forecasting and yfinance..."
# We install torch for CPU by default to save space on Mac unless it's an M-series, but pip will handle it.
pip install torch torchvision torchaudio
pip install git+https://github.com/amazon-science/chronos-forecasting.git
pip install yfinance pandas numpy

echo "✅ Chronos setup complete! You can now use the chronos_forecast tool."
