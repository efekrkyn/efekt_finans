from fastapi import FastAPI, Depends, HTTPException, Query, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import torch
import numpy as np
import yfinance as yf
from chronos import ChronosPipeline
import os
import uvicorn
import warnings

warnings.filterwarnings('ignore')

app = FastAPI(title="Chronos Forecast API")
security = HTTPBearer()

API_KEY = os.environ.get("CHRONOS_API_KEY", "")

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if API_KEY and credentials.credentials != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return credentials.credentials

# Load the model exactly once when the server starts
print("Loading Chronos model...")
device = "cuda" if torch.cuda.is_available() else "cpu"
pipeline = ChronosPipeline.from_pretrained(
    "amazon/chronos-t5-mini",
    device_map=device,
    dtype=torch.bfloat16 if device != "cpu" else torch.float32,
)
print("Model loaded.")

@app.get("/forecast")
def get_forecast(ticker: str = Query(...), days: int = Query(30), token: str = Depends(verify_token)):
    try:
        # Download historical data
        data = yf.download(ticker, period="2y", interval="1d", progress=False)
        if data.empty:
            raise ValueError(f"No historical data found for {ticker}")

        closing_prices = data['Close'].dropna().values.flatten()
        
        if len(closing_prices) < 50:
            raise ValueError(f"Not enough historical data for {ticker}. Need at least 50 days.")

        # Context is a 1D tensor of historical prices
        context = torch.tensor(closing_prices, dtype=torch.float32).flatten()
        
        # Predict
        forecast = pipeline.predict(
            context,
            prediction_length=days,
            num_samples=20,
        )
        
        forecast_np = np.array(forecast[0])
        quantiles = [0.1, 0.5, 0.9]
        low, median, high = np.quantile(forecast_np, quantiles, axis=0)

        last_price = float(closing_prices[-1])
        last_date = data.index[-1].strftime('%Y-%m-%d')
        
        result = {
            "ticker": ticker,
            "last_date": last_date,
            "last_price": round(last_price, 2),
            "prediction_length_days": days,
            "forecast": {
                "day_30_low": round(float(low[-1]), 2),
                "day_30_median": round(float(median[-1]), 2),
                "day_30_high": round(float(high[-1]), 2),
            },
            "trajectory_median": [round(float(x), 2) for x in median.tolist()]
        }

        return {"status": "success", "data": result}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
