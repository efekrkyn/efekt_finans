"""
TEFAS Fon Verileri Çekici
Kaynak: pytefas kütüphanesi
Kullanım: python tefas_fetcher.py [FUND_CODE]
"""
import sys
import json
import datetime

def fetch_fund_data(fund_code: str):
    try:
        from pytefas import Crawler
        tefas = Crawler()
        
        # Son 30 günün verisini çek (getiri hesaplamak için)
        end_dt = datetime.date.today()
        start_dt = end_dt - datetime.timedelta(days=45) # 1.5 ay geriye git ki en az 30 günlük işlem günü bulalım
        
        df = tefas.fetch(start=start_dt.strftime('%Y-%m-%d'), end=end_dt.strftime('%Y-%m-%d'), fund_code=fund_code)
        
        if df is None or df.empty:
            print(json.dumps({"error": f"{fund_code} için veri bulunamadı."}))
            return

        # Tarihe göre sırala
        df['date'] = df['date'].astype(str)
        df = df.sort_values(by='date')
        
        # En güncel kayıt
        latest = df.iloc[-1]
        
        # 1 aylık (yaklaşık 30 gün önceki) kayıt
        # Sadece son 21 iş gününe baksak da olur, yaklaşık df uzunluğundan hesaplayalım
        earliest = df.iloc[0]
        if len(df) > 20:
            earliest = df.iloc[-21] # Son 1 ay (21 iş günü)
            
        current_price = float(latest['price'])
        old_price = float(earliest['price'])
        
        # Getiri hesapla (%)
        monthly_return = ((current_price - old_price) / old_price) * 100 if old_price > 0 else 0
        
        result = {
            "fund_code": fund_code,
            "fund_name": str(latest['fund_name']),
            "date": str(latest['date']),
            "price": round(current_price, 6),
            "investor_count": int(latest.get('investor_count', 0)),
            "portfolio_size": round(float(latest.get('portfolio_size', 0)), 2),
            "monthly_return_pct": round(monthly_return, 2),
            "source": "TEFAS",
        }
        
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e), "fund_code": fund_code}))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Kullanım: python tefas_fetcher.py <FUND_CODE>"}))
        sys.exit(1)
    
    fund_code = sys.argv[1].upper()
    fetch_fund_data(fund_code)
