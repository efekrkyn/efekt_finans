import sys
import traceback
import json
import warnings
import torch
import numpy as np
import yfinance as yf
from chronos import ChronosPipeline

# Suppress warnings
warnings.filterwarnings('ignore')

def get_forecast(ticker: str, prediction_length: int = 30):
    try:
        # Download historical data (last 2 years to ensure good context)
        # Using .IS suffix for Turkish stocks if not already present
        fetch_ticker = ticker
        
        data = yf.download(fetch_ticker, period="2y", interval="1d", progress=False)
        if data.empty:
            raise ValueError(f"No historical data found for {fetch_ticker}")

        # Extract closing prices, drop NaNs, and flatten in case yfinance returns a 2D array
        closing_prices = data['Close'].dropna().values.flatten()
        
        if len(closing_prices) < 50:
            raise ValueError(f"Not enough historical data for {fetch_ticker}. Need at least 50 days.")

        # Determine device
        device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")

        # Load chronos pipeline
        pipeline = ChronosPipeline.from_pretrained(
            "amazon/chronos-t5-mini",
            device_map=device,
            dtype=torch.bfloat16 if device != "cpu" else torch.float32,
        )

        # Context is a 1D tensor of historical prices
        context = torch.tensor(closing_prices, dtype=torch.float32).flatten()
        
        # Predict
        forecast = pipeline.predict(
            context,
            prediction_length=prediction_length,
            num_samples=20,
        )
        
        # Calculate quantiles for confidence intervals
        # forecast[0] shape: (num_samples, prediction_length)
        forecast_np = np.array(forecast[0]) # if it's tensor, convert to numpy
        quantiles = [0.1, 0.5, 0.9]
        low, median, high = np.quantile(forecast_np, quantiles, axis=0)

        # Get last known price and date
        last_price = float(closing_prices[-1])
        last_date = data.index[-1].strftime('%Y-%m-%d')
        
        # Format the result
        result = {
            "ticker": ticker,
            "last_date": last_date,
            "last_price": round(last_price, 2),
            "prediction_length_days": prediction_length,
            "forecast": {
                "day_30_low": round(float(low[-1]), 2),
                "day_30_median": round(float(median[-1]), 2),
                "day_30_high": round(float(high[-1]), 2),
            },
            "trajectory_median": [round(float(x), 2) for x in median.tolist()]
        }

        print(json.dumps({"status": "success", "data": result}))
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Ticker argument is required."}))
        sys.exit(1)
        
    ticker_arg = sys.argv[1]
    days_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    get_forecast(ticker_arg, days_arg)
