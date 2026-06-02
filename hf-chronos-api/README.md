# Efekt Finans - Chronos API (Hugging Face Space)

Bu klasördeki dosyalar, Amazon Chronos ML fiyat tahmin modelini Hugging Face üzerinde ücretsiz bir API servisi olarak barındırmanız için hazırlanmıştır.

## Nasıl Kurulur? (3 Dakikalık İşlem)

1. **[Hugging Face](https://huggingface.co/)** sitesine gidin ve (yoksa) ücretsiz bir üyelik açın.
2. Üst menüden **Spaces** sekmesine tıklayıp **Create new Space** (Yeni Space Oluştur) butonuna basın.
3. Ayarları şöyle yapın:
   - **Space name**: `efekt-chronos-api` (istediğiniz bir ismi verebilirsiniz)
   - **License**: `mit` (veya blank bırakın)
   - **Select the Space SDK**: `Gradio` seçeneğine tıklayıp altından `Blank` seçin (veya `Docker` -> `Blank` seçin). En kolayı: SDK olarak **Docker** seçip **Blank** template seçmektir (FastAPI için Docker şablonu daha iyidir, ancak Hugging Face FastAPI'yi direkt olarak tanır).
   - **Space Hardware**: `Free (16GB RAM, 2 vCPU)`
4. Space oluşturulduktan sonra **Files** sekmesine girin.
5. Bilgisayarınızdaki şu iki dosyayı sürükleyip oraya yükleyin:
   - `app.py`
   - `requirements.txt`
6. Hugging Face sağ üstte "Building" diyecek ve birkaç dakika içinde modelinizi kuracak.
7. Eğer bir API şifresi belirlemek isterseniz, Space'in **Settings** sekmesine gidin, **Variables and secrets** bölümünden **New secret** oluşturup ismine `CHRONOS_API_KEY`, değerine de kendi belirlediğiniz bir şifreyi (örneğin `BenimGizliSifrem123`) yazın. Space'i yeniden başlatın (Restart).

## Sunucuya (DigitalOcean) Bağlama

Hugging Face size bir URL verecektir (Örn: `https://kullaniciadi-efekt-chronos-api.hf.space`).
Bu URL'yi kopyalayın ve sunucudaki `.env` dosyanıza şu şekilde ekleyin:

```env
CHRONOS_API_URL=https://kullaniciadi-efekt-chronos-api.hf.space
CHRONOS_API_KEY=BenimGizliSifrem123
```

İşlem bu kadar! Artık sistem yapay zeka modelini tamamen ücretsiz ve sunucuyu yormadan çekecek.
