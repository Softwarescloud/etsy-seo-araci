# Etsy SEO — Kişisel Anahtar Kelime Aracı

eRank benzeri, **tek kişilik kullanım** için tasarlanmış ücretsiz Etsy anahtar kelime araştırma aracı.
Veriler yalnızca Etsy'nin **resmi Open API v3**'ünden gelir; scraping yok, üyelik yok, aylık ücret yok.

## Kurulum

```bash
npm install
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

`.env` içine Etsy API anahtarını gir:

```
ETSY_API_KEY=senin_anahtarın
```

Anahtarı [etsy.com/developers/apps](https://www.etsy.com/developers/apps) adresinden alırsın.

> **Önemli:** Araç, aramalarda `GET /v3/application/listings/active` endpoint'ini kullanır. Bu endpoint
> Etsy's "kilitli" API'lerindendir; hesabında **Commercial / Production erişiminin açık olması** gerekir.
> Erişim kapalıysa arama 403 döner ve araç bunu açık bir mesajla bildirir. Anahtarı ücretsiz alabilirsin,
> ancak Etsy hesabına bağlı ticari onay isteyebilir.

Çalıştır:

```bash
npm start        # http://127.0.0.1:4310
npm run dev      # dosya değişince otomatik yeniden başlar
npm test         # çekirdek algoritma testleri (API anahtarı gerektirmez)
```

## Nasıl çalışır

Aradığın terim için Etsy'nin ilk **96 aktif ilanını** (2 × 48) çeker, sonra:

1. Her ilanın **başlığından** tekli ve ikili kelime grupları çıkarır.
2. Her ilanın **13 tag'inden** kelime ve kelime grupları çıkarır.
3. Her kelime için kaç ilanda geçtiğini, ilk 3 / ilk 10 sırada kaç kez geçtiğini ve ortalama sırasını hesaplar.
4. En güçlü birkaç kelimeyi doğrudan arayarak **toplam sonuç sayısını** (rekabet) ölçer.

### Skorlar ne anlama geliyor

| Skor | Anlamı |
|---|---|
| **Talep** (0-100) | Rakiplerin o kelimeyi ne sıklıkta kullandığı. Başlıktaki kullanım, tag'deki kullanım ve üst sıra yoğunluğunun ağırlıklı ortalaması. |
| **Kullanım %** | Örneklenen ilanların kaçında kelime geçiyor. |
| **İlk 3** | Kelimenin ilk 3 sıradaki ilanlarda kaç kez geçtiği — nişin "taşıyıcı kelimeleri" burada çıkar. |
| **Rekabet** | Kelime için Etsy'se verdiği toplam sonuç sayısı. |
| **Fırsat** (0-100) | Talep ÷ rekabet. **En yüksek fırsat = en az rekabetle en çok talep.** |

> **Dürüstlük notu:** Etsy arama hacmini (aylık arama sayısı) API'de **açıklamaz** — eRank bu veriyi
> Etsy'sen ticari anlaşma veya kendi topladığı tıklama verisiyle elde ediyor. Bu araç o sayıyı uydurmaz;
> bunun yerine rakiplerin davranışından türetilen, **göreli** bir talep göstergesi kullanır ve rekabet
> sayısını zaman içinde kendi veritabanında biriktirir. Gerçek hacim istiyorsan Google Keyword Planner
> (ücretsiz) ile Etsy için bir A/B testi yapmak en doğru yol.

## Dosya yapısı

```
src/
  server.ts             HTTP sunucu (node:http, bağımlılıksız)
  config.ts             .env okuma + yapılandırma
  db.ts                 SQLite şeması (node:sqlite — native derleme yok)
  etsy/client.ts        API istemcisi: hız sınırlayıcı, retry, hata sınıflama
  services/text.ts      metin normalizasyonu, kelime gruplama, durdurma kelimeleri
  services/keywords.ts  çekirdek mantık: ilan toplama, kazı, skorlama
public/                 arayüz (bağımlılıksız, sade HTML/CSS/JS)
test/smoke.ts           çekirdek testler
data/etsy-seo.db        SQLite veritabanı (otomatik oluşur)
```

## API

| Uç nokta | Açıklama |
|---|---|
| `GET /api/health` | Anahtar yapılandırılmış mı, önbellek durumu |
| `GET /api/keyword?seed=X&probe=1` | Ana araştırma. `probe=0` rekabet ölçümünü atlar (daha hızlı). |
| `GET /api/history?keyword=X` | Kelimenin toplam sonuç sayısı geçmişi |
| `GET /api/suggest?seed=X` | Yerel korpus tabanlı öneriler (Etsy'ye istek atmaz) |
| `GET/POST/DELETE /api/saved` | Kayıtlı kelime listesi |

## Veri ve gizlilik

- Her şey yerelde: `data/etsy-seo.db`. Sunucu `127.0.0.1`'e bağlanır, dışarıya açılmaz.
- API anahtarı yalnızca `.env` içinde tutulur, `.gitignore`'da.
- Etsy'ye yapılan her istek `127.0.0.1:4310/api/keyword` çağrısından gelir; önbellek sayesinde
  aynı terim 3 saat içinde tekrar çekilmez.
- Varsayılan 4 istek/sn. Etsy günlük kotanı vardır; `.env` içinden düşürebilirsin.

## Sınırlar

- Gerçek arama hacmi yok (yukarıda açıklandı).
- Rekabet ölçümü en güçlü birkaç kelimeyle sınırlı (`MAX_PROBE_CALLS`), çünkü her ölçüm Etsy kotasından yer.
- Kişisel kullanım için tasarlandı; mağaza adı veya kimlik doğrulama yoktur — sunucu ağa açılmamalı.
