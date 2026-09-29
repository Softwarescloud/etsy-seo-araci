# Etsy SEO — Kişisel Anahtar Kelime Aracı

eRank benzeri, **tek kişilik kullanım** için tasarlanmış ücretsiz Etsy anahtar kelime araştırma aracı.
Veriler yalnızca Etsy'nin **resmi Open API v3**'ünden gelir; scraping yok, üyelik yok, aylık ücret yok.

## Hızlı kurulum

**Windows'ta** — [Code'u indir](https://github.com/Softwarescloud/etsy-seo-araci/archive/refs/heads/main.zip), klasörü aç, **`KUR.bat`** dosyasına çift tıkla. Bağımlılıkları kurar, `.env`'i oluşturur, API anahtarını sorar, sunucuyu başlatır ve tarayıcıyı açar.

Elle kurmak istersen:

```bash
git clone https://github.com/Softwarescloud/etsy-seo-araci.git
cd etsy-seo-araci
npm install
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux
```

`.env` içine Etsy kimlik bilgilerini gir:

```
ETSY_API_KEY=<keystring>
ETSY_SHARED_SECRET=<shared secret>
```

> **Önemli:** Etsy `x-api-key` başlığında **iki değeri nokta üst üste** ister: `keystring:shared_secret`.
> İkisini `ETSY_API_KEY=a:b` biçiminde tek satırda da yazabilirsin. Sadece keystring yetmez —
> Etsy `"Shared secret is required in x-api-key header"` hatası döndürür.

İki değer de https://www.etsy.com/developers/your-apps sayfasında. Mağaza denetimi için
`ETSY_SHOP_ID` de gerekir (mağaza adının `.etsy.com` eki olmadan).

> **Önemli:** Araç, aramalarda `GET /v3/application/listings/active` endpoint'ini kullanır. Bu endpoint
> Etsy's "kilitli" API'lerindendir; uygulamanın **Production/Commercial** erişimi açık olmadan arama
> 403 döner ve araç bunu ekranda açıkça bildirir.


Çalıştır:

```bash
npm start        # http://127.0.0.1:4310
npm run dev      # dosya değişince otomatik yeniden başlar
npm run once     # otomasyonu bir kez çalıştırıp kapanır (Görev Zamanlayıcı için)
npm test         # çekirdek algoritma testleri (API anahtarı gerektirmez)
```

## Özellikler

### 1. Anahtar kelime araştırması

Aradığın terimin ilk **96 aktif ilanını** (2 × 48) çeker, sonra:

1. Her ilanın **başlığından** tekli ve ikili kelime grupları çıkarır.
2. Her ilanın **13 tag'inden** kelime ve kelime grupları çıkarır.
3. Her kelime için kaç ilanda geçtiğini, ilk 3 / ilk 10 sırada kaç kez geçtiğini ve ortalama sırasını hesaplar.
4. En güçlü birkaç kelimeyi doğrudan arayarak **toplam sonuç sayısını** (rekabet) ölçer.

| Skor | Anlamı |
|---|---|
| **Talep** (0-100) | Rakiplerin o kelimeyi ne sıklıkta kullandığı. |
| **Kullanım %** | Örneklenen ilanların kaçında kelime geçiyor. |
| **İlk 3** | Kelimenin ilk 3 sıradaki ilanlarda kaç kez geçtiği — nişin "taşıyıcı kelimeleri" burada çıkar. |
| **Rekabet** | Kelime için Etsy'se verdiği toplam sonuç sayısı. |
| **Fırsat** (0-100) | Talep ÷ rekabet. **En yüksek fırsat = en az rekabetle en çok talep.** |

### 2. Mağaza denetimi

Mağazanın aktif ilanlarını çekip her birini puanlar (A/B/C/D) ve şu kuralları kontrol eder:

- Başlık 140 karakter sınırı, 40-70 ideal aralığı
- Tag sayısı 13, tag uzunluğu 20 karakter
- Yinelenen tag'ler
- Boş veya çok kısa açıklama
- **Kaydettiğin hedef kelimelerin ilanda kullanılıp kullanılmadığı**

### 3. Kayıtlı kelimeler

Yıldızladığın kelimeleri saklar, ilanlarına yapıştırmak için **13 tag** olarak kopyalar, CSV olarak dışa aktarır.
Aynı kelimeyi tekrar araştırdıkça rekabet geçmişi birikir ve trend oku çıkar.

> **Dürüstlük notu:** Etsy arama hacmini (aylık arama sayısı) API'de **açıklamaz** — eRank bu veriyi
> Etsy'sen ticari anlaşma veya kendi topladığı tıklama verisiyle elde ediyor. Bu araç o sayıyı uydurmaz;
> bunun yerine rakiplerin davranışından türetilen, **göreli** bir talep göstergesi kullanır ve rekabet
> sayısını zaman içinde kendi veritabanında biriktirir. Gerçek hacim istiyorsan Google Keyword Planner
> (ücretsiz) ile Etsy için bir A/B testi yapmak en doğru yol.

### 4. Zamanlanmış otomasyon

Her gece iki görev otomatik çalışır ve sonuçları veritabanına yazar:

| Görev | Ne yapar |
|---|---|
| **Mağaza denetimi** | Aktif ilanları yeniden puanlar, günlük geçmişe yazar. Skoru düşen ilanları gösterir. |
| **Kelime tazeleme** | Kayıtlı kelimelerin toplam sonuç sayısını (rekabet) yeniden ölçer. Böylece gerçek trend verisi oluşur. |

İki çalışma biçimi var:

- **Sunucu açıkken** — `npm start` çalışıyorsa kendiliğinden tetiklenir (`.env`'deki `AUTOMATION_HOUR`).
- **Sunucu kapalıyken** — `OTOMASYON.bat` çalıştır: Windows Görev Zamanlayıcı'ya görev kaydeder, her gün 04:00'te `npm run once` çağırır, işleyip kapanır.

Arayüzdeki **Otomasyon** panelinden: sonraki koşu saati, son koşular, mağaza sağlık skorunun günlük grafiği, kayıtlı kelimelerdeki rekabet değişimi ve **"Şimdi çalıştır"** butonu.

> ⚠️ Otomasyon **sunucunun açık olduğu saatlerde** Etsy'ye istek atar. Bilgisayarın gece açık kalması ya da
> Görev Zamanlayıcı kullanman gerekir.

## Dosya yapısı

```
src/
  server.ts             HTTP sunucu (node:http, bağımlılıksız)
  config.ts             .env okuma + yapılandırma
  db.ts                 SQLite şeması (node:sqlite — native derleme yok)
  etsy/client.ts        API istemcisi: hız sınırlayıcı, retry, hata sınıflama
  services/text.ts      metin normalizasyonu, kelime gruplama, durdurma kelimeleri
  services/keywords.ts  çekirdek mantık: ilan toplama, kazı, skorlama
  services/audit.ts     ilan denetimi: Etsy kuralları, puanlama, özet
  services/automation.ts zamanlanmış görevler, koşu geçmişi, trend raporları
public/                 arayüz (bağımlılıksız, sade HTML/CSS/JS)
test/smoke.ts           çekirdek testler
KUR.bat                 Windows'ta tek tıkla kurulum
OTOMASYON.bat           Windows Görev Zamanlayıcı'ya günlük görev kaydeder
data/etsy-seo.db        SQLite veritabanı (otomatik oluşur)
```

## API

| Uç nokta | Açıklama |
|---|---|
| `GET /api/health` | Anahtar yapılandırılmış mı, önbellek durumu |
| `GET /api/keyword?seed=X&probe=1` | Ana araştırma. `probe=0` rekabet ölçümünü atlar (daha hızlı). |
| `GET /api/history?keyword=X` | Kelimenin toplam sonuç sayısı geçmişi |
| `GET /api/suggest?seed=X` | Yerel korpus tabanlı öneriler (Etsy'ye istek atmaz) |
| `GET /api/saved` | Kayıtlı kelime listesi |
| `POST /api/saved` | Kelime kaydet — `{ "keyword": "dog collar", "note": "ilisikli" }` |
| `DELETE /api/saved?keyword=X` | Kelime sil |
| `GET /api/shop/audit?shopId=X&keywords=a,b` | Mağaza denetimi. `shopId` verilmezse `.env`'deki `ETSY_SHOP_ID` kullanılır. |
| `GET /api/automation/status` | Otomasyon açık mı, sonraki koşu ne zaman, son koşular |
| `POST /api/automation/run[?task=X]` | Görevleri elle çalıştır. `task` verilmezse ikisi de çalışır. |
| `GET /api/automation/history` | Koşu geçmişi, mağaza skor serisi, kelime trendleri |

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
