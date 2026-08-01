# GİB Tahsilat → Excel

Dijital Vergi Dairesi'ndeki **"Ödeme Alındılarım ve Tahsilat Bilgilerim"** ekranındaki
tahsilatları, **her alındının detayıyla birlikte** tek tıkla Excel'e aktaran tarayıcı
eklentisi.

Ekran güncellendikten sonra liste, tahsilatları yüzeysel gösteriyor; vergi türü, dönem ve
**MTV'de araç plakası** gibi bilgiler ancak her tahsilatın *Tahsilat Bilgileri* bağlantısına
tek tek tıklayınca görülebiliyor. Bu araç iki ekranı birleştirip tek tabloya döküyor.
Ayrıca alındı PDF'lerini tek bir `.zip` içinde toplu indirebiliyor.

Ücretsizdir. Hiçbir veri bilgisayarınızdan dışarı çıkmaz.

---

## Kurulum (5 dakika)

### 1. Tampermonkey'i kurun

<https://www.tampermonkey.net> → tarayıcınızı seçin (Chrome veya Edge) → **Ekle**.
Ücretsizdir, tek seferliktir.

### 2. Eklentiyi kurun

Aşağıdaki bağlantıya tıklayın; Tampermonkey kurulum ekranını açar, **Kur** deyin:

**<https://raw.githubusercontent.com/muhasebeahmetozmen/gib-tahsilat-excel/main/dist/gib-tahsilat-excel.user.js>**

Kurduktan sonra yeni sürümleri Tampermonkey kendisi bulur.

### 3. Kullanın

1. <https://dijital.gib.gov.tr> adresine girip **her zamanki gibi kendiniz giriş yapın.**
   (Eklenti şifrenizi görmez, saklamaz, sizin yerinize giriş yapmaz.)
2. Sağ altta **GİB - Sorgulama Paneli** düğmesi belirir. Her sayfada vardır — ilgili
   ekrana gitmenize gerek yok.
3. Düğmeye basın. Panelin en üstünde mükellef adı görünür.
4. Ödeme yılını seçin; isterseniz vergi dönemi / vergi türü / vergi dairesi / plaka
   süzgeçlerini kullanın.
5. **Sorgula ve Excel'e Aktar** deyin. Bitince dosya kendiliğinden iner.

Dosya adı mükellef adından üretilir; şirketlerde unvan kısaltılır
(*DENEME OTOMOTİV SANAYİ VE TİCARET ANONİM ŞİRKETİ* → `DENEME OTO. SAN. TİC. A.Ş. GİB TAHSİLAT 2026.xlsx`).

---

## Paneldeki alanlar

| Alan | Ne işe yarar |
|---|---|
| **Ödeme Yılı** | İlk açılışta yıllar taranır; listede **yalnızca kaydınız olan yıllar** görünür. Tek tıkla bir yıl, **Ctrl** ile birden fazla yıl seçilir; hiçbiri seçilmezse tüm yıllar taranır. Yeni ödeme yaptıysanız **↻ Yılları yenile**. |
| **Vergi dönemi başlangıç / bitiş** | İsteğe bağlı. `AA.YYYY` yazın (rakamları yazın, noktayı kendisi koyar) veya takvim simgesinden seçin. Boş = yılın tamamı. |
| **Vergi türü** | Açılır listede **arama** kutusu vardır. **Ctrl** ile çoklu seçim yapılabilir. Süzgeç satır bazında çalışır: MTV seçerseniz aynı alındıdaki KDV satırları gelmez. Liste seçilen yıla göre değişir. |
| **Vergi dairesi** | Aynı şekilde aranabilir açılır liste. |
| **Plaka içerir** | MTV için tek bir aracın ödemelerini süzer. Boşluk/tire önemsizdir. |
| **Alındı PDF'lerini indir** | Sorgudan sonra çıkar: alındıların GİB'deki PDF'lerini **tek bir .zip** içinde verir. |
| **Durdur** | Uzun süren sorguyu durdurur. **O ana kadar toplananlar kaybolmaz.** |
| **Ayrıntı** | İşlem kaydını açar; yanındaki sayı uyarı/hata adedini gösterir. |

Sorgu bitince panelde **vergi türü bazında özet** (adet, tutar, genel toplam) görünür.
Panel önemli bir yeri kapatıyorsa başlığından tutup sürükleyebilirsiniz.
Mükellef değiştirdiğinizde panel kendini sıfırlar.

## Excel çıktısı

Sütun adları GİB'in kendi *Excel'e Aktar* çıktısıyla aynıdır:

**Ödeme Yılı · Ödeme Kaynağı · Alındı No · Ödeme Yeri · İşlem Tarihi · Tahsilat Şekli ·
Ödeme Şekli** → **Vergi Dairesi · Belge No · Vergi Türü · Vergi Dönemi · Plaka ·
Ödeme Tarihi · Tutar · Özellik · Tahsilat İşlem Türü** → **Not**

Bir alındıda birden fazla vergi satırı olabilir (MTV'de her araç ayrı satır); bu yüzden
her alındı birden fazla satıra açılır ve alındı bilgileri tekrarlanır. Tek tutar sütunu
**Tutar**'dır ve satır bazlıdır — doğrudan toplayabilirsiniz.

Tutarlar gerçek sayı, tarihler gerçek tarih; alındı/belge numaraları ve plaka metin
biçimindedir (Excel bilimsel gösterime çevirmez, baştaki sıfırları silmez).

## Takıldığınızda

| Sorun | Çözüm |
|---|---|
| Düğme görünmüyor | `F5` ile yenileyin; Tampermonkey'den eklentinin **etkin** olduğunu kontrol edin. |
| "Oturum bilgisi bulunamadı" | Giriş yapmadan sorgu yapılamaz. Giriş yapıp `F5`. |
| "Oturum geçersiz (HTTP 401)" | Oturum zaman aşımına uğramış. `F5` → tekrar giriş. |
| "Servis istek limitine ulaşıldı" | GİB'in kendi sınırı. Birkaç dakika bekleyip tekrar deneyin; toplananlar korunur. |
| Yıl listesinde bir yıl yok | O yılda kaydınız yoktur. Yeni ödeme yaptıysanız **↻ Yılları yenile**. |
| Sonuç boş geldi | Süzgeçleri gözden geçirin; vergi türünü **Tümü** yapıp deneyin. |
| Bazı satırlarda "Not" dolu | O alındının detayı alınamamış; alındı bilgileri yine de gelir. |
| Çok yavaş | Kasıtlıdır. GİB sunucusunu yormamak için istekler aralıklı atılır. |

## Gizlilik ve sınırlar

- Tüm işlem **sizin tarayıcınızda** olur; hiçbir veri hiçbir sunucuya gönderilmez.
- Eklenti giriş bilgilerinizi görmez ve saklamaz; sizin yerinize giriş yapmaz.
- Yalnızca sizin ekranınızda **zaten görebildiğiniz** veriler, tek tek tıklamak yerine
  otomatik toplanır.
- Sunucuya saygılı çalışır: istekler sıralı ve aralıklı atılır, sınır uyarısı gelirse durur.
- Resmî bir GİB ürünü değildir.
- İndirdiğiniz Excel ve zip dosyaları vergi verisi içerir; paylaşırken dikkat edin.
