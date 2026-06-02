"""
İş Yatırım Finansal Tablo Çekici
Kaynak: urazakgul/isyatirimhisse kütüphanesi
Kullanım: python isyatirim_fetcher.py TUPRS [start_year] [end_year]
"""
import sys
import json
from isyatirimhisse import fetch_financials, fetch_stock_data

def get_financials(symbol: str, start_year: str = None, end_year: str = None):
    """BIST hissesinin bilanço, gelir tablosu, nakit akış verilerini çek"""
    try:
        import datetime
        if not end_year:
            end_year = str(datetime.date.today().year)
        if not start_year:
            start_year = str(int(end_year) - 2)

        df = fetch_financials(symbol, start_year=start_year, end_year=end_year)
        
        if df is None or df.empty:
            print(json.dumps({"error": "Veri bulunamadı", "symbol": symbol}))
            return

        # Dönem sütunlarını bul (YYYY/Q formatında)
        period_cols = [c for c in df.columns if '/' in str(c) and c not in ['SYMBOL']]
        period_cols.sort()

        # Önemli kalemleri çıkar
        key_items = {
            # Bilanço
            '1A': 'donen_varliklar',        # Dönen Varlıklar
            '1AK': 'duran_varliklar',       # Duran Varlıklar
            '1AA': 'nakit',                  # Nakit ve Nakit Benzerleri
            '1AC': 'ticari_alacaklar',       # Ticari Alacaklar
            '1AF': 'stoklar',                # Stoklar
            '2': 'toplam_varliklar',         # TOPLAM VARLIKLAR
            '2A': 'kisa_vadeli_yukumlulukler',  # Kısa Vadeli Yükümlülükler
            '2AA': 'kisa_vadeli_borc',       # Kısa Vadeli Finansal Borçlar
            '2AK': 'uzun_vadeli_yukumlulukler', # Uzun Vadeli Yükümlülükler
            '2B': 'toplam_yukumlulukler',    # TOPLAM YÜKÜMLÜLÜKLER
            '3': 'ozkaynaklar',              # ÖZKAYNAKLAR
            # Gelir Tablosu
            '4A': 'hasilat',                 # Hasılat (Gelir)
            '4B': 'satis_maliyeti',          # Satışların Maliyeti
            '4C': 'brut_kar',                # Brüt Kâr
            '4D': 'faaliyet_kari',           # Esas Faaliyet Kârı
            '4I': 'vergi_oncesi_kar',        # Vergi Öncesi Kâr
            '4K': 'net_kar',                 # Dönem Net Kârı
            # Nakit Akış
            '5A': 'isletme_nakit_akisi',     # İşletme Faaliyetlerinden Nakit
            '5B': 'yatirim_nakit_akisi',     # Yatırım Faaliyetlerinden Nakit
            '5C': 'finansman_nakit_akisi',   # Finansman Faaliyetlerinden Nakit
        }

        result = {
            "symbol": symbol,
            "periods": period_cols,
            "data": {},
            "raw_count": len(df),
        }

        for _, row in df.iterrows():
            code = str(row.get('FINANCIAL_ITEM_CODE', '')).strip()
            if code in key_items:
                field_name = key_items[code]
                values = {}
                for period in period_cols:
                    val = row.get(period, None)
                    if val is not None:
                        try:
                            values[period] = float(val)
                        except (ValueError, TypeError):
                            values[period] = None
                    else:
                        values[period] = None
                
                result["data"][field_name] = {
                    "name_tr": str(row.get('FINANCIAL_ITEM_NAME_TR', '')),
                    "name_en": str(row.get('FINANCIAL_ITEM_NAME_EN', '')),
                    "values": values
                }

        # Temel rasyoları hesapla (son dönem)
        if period_cols:
            last_period = period_cols[-1]
            d = result["data"]
            
            ratios = {}
            
            # Cari Oran
            dv = d.get('donen_varliklar', {}).get('values', {}).get(last_period)
            kvy = d.get('kisa_vadeli_yukumlulukler', {}).get('values', {}).get(last_period)
            if dv and kvy and kvy != 0:
                ratios['cari_oran'] = round(dv / kvy, 2)
            
            # Borç/Özkaynak
            ty = d.get('toplam_yukumlulukler', {}).get('values', {}).get(last_period)
            oz = d.get('ozkaynaklar', {}).get('values', {}).get(last_period)
            if ty and oz and oz != 0:
                ratios['borc_ozkaynak'] = round(ty / oz, 2)
            
            # Net Kâr Marjı
            nk = d.get('net_kar', {}).get('values', {}).get(last_period)
            h = d.get('hasilat', {}).get('values', {}).get(last_period)
            if nk and h and h != 0:
                ratios['net_kar_marji'] = round((nk / h) * 100, 2)
            
            # ROE
            if nk and oz and oz != 0:
                ratios['roe'] = round((nk / oz) * 100, 2)
            
            # ROA
            tv = d.get('toplam_varliklar', {}).get('values', {}).get(last_period)
            if nk and tv and tv != 0:
                ratios['roa'] = round((nk / tv) * 100, 2)
            
            result["ratios"] = ratios
            result["last_period"] = last_period

        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e), "symbol": symbol}, ensure_ascii=False))


def get_stock_price(symbol: str):
    """BIST hissesinin fiyat geçmişini çek"""
    try:
        import datetime
        end = datetime.date.today().strftime('%d-%m-%Y')
        start = (datetime.date.today() - datetime.timedelta(days=365)).strftime('%d-%m-%Y')
        
        df = fetch_stock_data(symbol, start_date=start, end_date=end)
        
        if df is None or df.empty:
            print(json.dumps({"error": "Fiyat verisi bulunamadı", "symbol": symbol}))
            return
        
        # Son 5 günü döndür
        recent = df.tail(5)
        prices = []
        for idx, row in recent.iterrows():
            prices.append({
                "date": str(idx) if not hasattr(idx, 'strftime') else idx.strftime('%Y-%m-%d'),
                "close": float(row.get('CLOSING_TL', row.iloc[0])) if len(row) > 0 else None,
            })
        
        print(json.dumps({"symbol": symbol, "prices": prices}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "symbol": symbol}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Kullanım: python isyatirim_fetcher.py <TICKER> [start_year] [end_year]"}))
        sys.exit(1)
    
    symbol = sys.argv[1].upper()
    mode = sys.argv[2] if len(sys.argv) > 2 else 'financials'
    
    if mode == 'price':
        get_stock_price(symbol)
    else:
        start_y = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].isdigit() else None
        end_y = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].isdigit() else None
        get_financials(symbol, start_y, end_y)
