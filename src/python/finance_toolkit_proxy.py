"""
FinanceToolkit Proxy — 150+ finansal rasyo hesaplama
Kaynak: JerBouma/FinanceToolkit + DefeatBeta fallback
Kullanım: python finance_toolkit_proxy.py AAPL [FMP_API_KEY]
"""
import sys
import json
import os
import logging

# Suppress defeatbeta banner & logs
logging.disable(logging.CRITICAL)
os.environ['DEFEATBETA_LOG_LEVEL'] = 'CRITICAL'


def _safe_last(df, col_name=None):
    """DataFrame'den son satırın belirli sütunundaki değeri al"""
    import pandas as pd
    if df is None:
        return None
    if isinstance(df, (int, float)):
        return float(df)
    if isinstance(df, pd.DataFrame):
        if df.empty:
            return None
        if col_name and col_name in df.columns:
            val = df[col_name].iloc[-1]
        else:
            # Son sayısal sütunu bul
            numeric_cols = df.select_dtypes(include='number').columns
            if len(numeric_cols) > 0:
                val = df[numeric_cols[-1]].iloc[-1]
            else:
                val = df.iloc[-1, -1]
        try:
            return round(float(val), 4)
        except:
            return None
    if isinstance(df, pd.Series):
        if df.empty:
            return None
        try:
            return round(float(df.iloc[-1]), 4)
        except:
            return None
    return None


def fetch_with_toolkit(symbol: str, api_key: str = None):
    """FinanceToolkit ile 150+ rasyo hesapla"""
    try:
        from financetoolkit import Toolkit
        
        if not api_key:
            api_key = os.environ.get('FMP_API_KEY', '')
        
        if not api_key:
            return {"error": "FMP_API_KEY gerekli"}
        
        companies = Toolkit([symbol], api_key=api_key)
        result = {"symbol": symbol, "source": "financetoolkit"}
        
        for category, method_name in [
            ("profitability", "collect_profitability_ratios"),
            ("liquidity", "collect_liquidity_ratios"),
            ("solvency", "collect_solvency_ratios"),
            ("efficiency", "collect_efficiency_ratios"),
            ("valuation", "collect_valuation_ratios"),
        ]:
            try:
                df = getattr(companies.ratios, method_name)()
                if df is not None and not df.empty:
                    last_col = df.columns[-1]
                    result[category] = {}
                    for idx in df.index:
                        val = df.loc[idx, last_col]
                        if val is not None:
                            try:
                                result[category][str(idx)] = round(float(val), 4)
                            except:
                                pass
            except:
                pass
        
        return result
        
    except Exception as e:
        return {"error": str(e), "symbol": symbol}


def fetch_with_defeatbeta(symbol: str):
    """DefeatBeta API ile temel rasyoları çek (FMP key yoksa fallback)"""
    try:
        # Redirect stdout temporarily to suppress banner
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        
        from defeatbeta_api.data.ticker import Ticker
        t = Ticker(symbol)
        
        sys.stdout = old_stdout
        
        result = {
            "symbol": symbol,
            "source": "defeatbeta",
            "profitability": {},
            "liquidity": {},
            "solvency": {},
            "valuation": {},
        }
        
        # ROE — son satırdaki 'roe' sütunu
        v = _safe_last(t.roe(), 'roe')
        if v is not None: result["profitability"]["ROE"] = v
        
        # ROA
        v = _safe_last(t.roa(), 'roa')
        if v is not None: result["profitability"]["ROA"] = v
        
        # ROIC
        v = _safe_last(t.roic(), 'roic')
        if v is not None: result["profitability"]["ROIC"] = v
        
        # ROCE
        v = _safe_last(t.roce(), 'roce')
        if v is not None: result["profitability"]["ROCE"] = v
        
        # Debt to Equity
        v = _safe_last(t.debt_to_equity(), 'debt_to_equity')
        if v is not None: result["solvency"]["Debt_to_Equity"] = v
        
        # P/E
        v = _safe_last(t.ttm_pe(), 'ttm_pe')
        if v is not None: result["valuation"]["PE_Ratio"] = v
        
        # P/B
        v = _safe_last(t.pb_ratio(), 'pb_ratio')
        if v is not None: result["valuation"]["PB_Ratio"] = v
        
        # P/S
        v = _safe_last(t.ps_ratio(), 'ps_ratio')
        if v is not None: result["valuation"]["PS_Ratio"] = v
        
        # EV/EBITDA
        v = _safe_last(t.enterprise_to_ebitda(), 'enterprise_to_ebitda')
        if v is not None: result["valuation"]["EV_EBITDA"] = v
        
        # Market Cap
        v = _safe_last(t.market_capitalization(), 'market_cap')
        if v is not None: result["valuation"]["Market_Cap"] = v
        
        # EV
        v = _safe_last(t.enterprise_value(), 'enterprise_value')
        if v is not None: result["valuation"]["Enterprise_Value"] = v
        
        # WACC
        v = _safe_last(t.wacc(), 'wacc')
        if v is not None: result["valuation"]["WACC"] = v
        
        # TTM EPS
        v = _safe_last(t.ttm_eps(), 'ttm_eps')
        if v is not None: result["profitability"]["TTM_EPS"] = v
        
        # TTM Revenue
        v = _safe_last(t.ttm_revenue(), 'ttm_revenue')
        if v is not None: result["profitability"]["TTM_Revenue"] = v
        
        # TTM FCF
        v = _safe_last(t.ttm_fcf(), 'ttm_fcf')
        if v is not None: result["profitability"]["TTM_FCF"] = v
        
        # TTM EBITDA
        v = _safe_last(t.ttm_ebitda(), 'ttm_ebitda')
        if v is not None: result["profitability"]["TTM_EBITDA"] = v
        
        return result
        
    except Exception as e:
        # Restore stdout if error
        sys.stdout = sys.__stdout__
        return {"error": str(e), "symbol": symbol}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Kullanım: python finance_toolkit_proxy.py <TICKER> [FMP_API_KEY]"}))
        return
    
    symbol = sys.argv[1].upper()
    api_key = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('FMP_API_KEY', '')
    
    if api_key:
        result = fetch_with_toolkit(symbol, api_key)
        # Toolkit sonuç döndüyse ve en az bir kategori dolu ise kullan
        has_data = 'error' not in result and any(
            isinstance(result.get(cat), dict) and len(result.get(cat, {})) > 0
            for cat in ['profitability', 'liquidity', 'solvency', 'efficiency', 'valuation']
        )
        if has_data:
            print(json.dumps(result, ensure_ascii=False))
            return
    
    result = fetch_with_defeatbeta(symbol)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
