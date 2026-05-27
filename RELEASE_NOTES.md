# Dexter v2026.5.27 Sürüm Notları

Bu sürümde Dexter Dashboard için 5 büyük yeni özellik eklenmiştir:

1. **Hisse Fiyat Grafiği:** `/api/price-history` endpoint'i üzerinden Yahoo Finance geçmiş fiyat verileri çekilmiş ve `recharts` kullanılarak etkileşimli bir çizgi grafiği (1A, 3A, 6A, 1Y, 5Y aralıklarıyla) oluşturulmuştur.
2. **Portföy Simülatörü (Kağıt Portföy):** Gerçek para riski olmadan strateji denemeye olanak tanıyan, `localStorage` ile kalıcı bir portföy sekmesi eklendi. Anlık kâr/zarar durumları `api/analysis` fiyatları ile hesaplanmaktadır.
3. **Çalışan Bildirim Sistemi:** Belirlenen fiyat hedeflerine (altında/üstünde) ulaşıldığında kullanıcıyı uyaran, 60 saniyelik bir döngü ile fiyatları kontrol eden ve tarayıcı `Notification` API'sini tetikleyen aktif bir uyarı sistemi eklendi.
4. **Mobil Uyum (Responsive Tasarım):** Yan menü gizlenebilir hale getirildi (hamburger menü eklendi). Tablolar ve grid yapısı (CSS grid template) dar ekranlı cihazlara göre optimize edildi.
5. **CSV/Excel Dışa Aktarma:** Yıllık ve çeyreklik temel analiz verilerini ile kişisel portföy durumunu bilgisayara `CSV` formatında indirebilmek için dışa aktarım özelliği (ve "CSV İndir" butonları) entegre edildi.

*Teknik Detaylar:*
- React 18 & Vite & Bun kullanılarak geliştirildi.
- Typescript derleme süreçleri başarıyla geçti (`tsc --noEmit`).
