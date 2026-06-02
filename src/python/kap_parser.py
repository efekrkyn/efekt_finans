import sys
import json
import traceback
import io
from urllib.parse import urljoin
from curl_cffi import requests
from bs4 import BeautifulSoup
import pdfplumber

def parse_kap_disclosure(url_or_id: str):
    try:
        disclosure_id = url_or_id.split('/')[-1]
        url = f"https://www.kap.org.tr/tr/Bildirim/{disclosure_id}"
        
        session = requests.Session(impersonate="chrome110")
        response = session.get(url, timeout=15)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. Extract HTML text
        text_content = ""
        text_blocks = soup.find_all('div', class_='text-block-value')
        if not text_blocks:
            text_blocks = soup.find_all('div', class_='summary-text')
        
        for block in text_blocks:
            text_content += block.get_text(separator='\n', strip=True) + "\n\n"
        
        # 2. Extract PDF attachments if any
        pdf_texts = []
        pdf_links = soup.find_all('a', href=True)
        for link in pdf_links:
            href = link['href']
            if href.lower().endswith('.pdf') or 'BildirimPdf' in href:
                pdf_url = urljoin("https://www.kap.org.tr", href)
                try:
                    pdf_res = session.get(pdf_url, timeout=15)
                    if pdf_res.status_code == 200:
                        with pdfplumber.open(io.BytesIO(pdf_res.content)) as pdf:
                            extracted = ""
                            for page in pdf.pages:
                                extracted += (page.extract_text() or "") + "\n"
                            pdf_texts.append(extracted.strip())
                except Exception as e:
                    pdf_texts.append(f"[PDF Extract Error: {str(e)}]")
        
        result = {
            "url": url,
            "disclosure_id": disclosure_id,
            "html_text": text_content.strip(),
            "pdf_texts": pdf_texts
        }
        
        print(json.dumps({"status": "success", "data": result}))
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Disclosure ID or URL is required."}))
        sys.exit(1)
        
    url_arg = sys.argv[1]
    parse_kap_disclosure(url_arg)
