// ==UserScript==
// @name         GİB Tahsilat → Excel
// @namespace    gib-tahsilat-excel
// @version      1.0.17
// @description  Dijital Vergi Dairesi "Ödeme Alındılarım ve Tahsilat Bilgilerim" ekranındaki tahsilatları DETAYLARIYLA birlikte tek tıkla Excel'e aktarır. Tamamen ücretsiz, veriler bilgisayardan dışarı çıkmaz.
// @updateURL    https://raw.githubusercontent.com/muhasebeahmetozmen/gib-tahsilat-excel/main/dist/gib-tahsilat-excel.user.js
// @downloadURL  https://raw.githubusercontent.com/muhasebeahmetozmen/gib-tahsilat-excel/main/dist/gib-tahsilat-excel.user.js
// @match        https://dijital.gib.gov.tr/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/* Bu dosya build.py tarafindan uretildi. Elle duzenleme; src/ altini duzenle. */
/* Surum: 1.0.17 */

(function () {
'use strict';

/* ==================== 10-yardimci.js ==================== */
/* Ortak küçük yardımcılar: bekleme, tarih/sayı çevirme, olay duyurusu. */

const Yard = (function () {

  function bekle(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* "27/07/2026" -> Date   |  çözülemezse null */
  function tarihCoz(s) {
    if (s instanceof Date) return s;
    if (!s || typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (!m) return null;
    const gun = +m[1], ay = +m[2], yil = +m[3];
    if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return null;
    const d = new Date(yil, ay - 1, gun);
    // 31/02 gibi taşan tarihleri ele
    if (d.getFullYear() !== yil || d.getMonth() !== ay - 1 || d.getDate() !== gun) return null;
    return d;
  }

  /* "841.74" | 6244 | "1.234,56" -> sayı  |  çözülemezse null */
  function sayiCoz(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const ham = v.trim();
    if (!ham) return null;

    // GİB'in detay biçimi: nokta ondalıklı, en fazla 2 hane ("841.74", "791.00")
    if (/^-?\d+\.\d{1,2}$/.test(ham)) return parseFloat(ham);
    if (/^-?\d+$/.test(ham)) return parseInt(ham, 10);

    let s = ham;
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      // hangisi sonda ise ondalık ayıracı odur
      s = (s.lastIndexOf(',') > s.lastIndexOf('.'))
        ? s.replace(/\./g, '').replace(/,/g, '.')
        : s.replace(/,/g, '');
    } else if (s.indexOf(',') !== -1) {
      s = s.replace(/,/g, '.');
    }
    s = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function metin(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  /*
   * Ay-yıl girdisini GİB'in beklediği "YYYYAA" biçimine çevirir.
   * Kabul edilenler: "06.2026" (panel biçimi), "2026-06" (takvim), "06/2026", "062026", "202606"
   * Boşsa ''  ·  çözülemezse null (çağıran kullanıcıyı uyarsın)
   *
   * YIL DENETİMİ ZORUNLU: "01.0620" gibi yarım kalmış bir girdi sessizce
   * kabul edilirse dönem süzgeci fiilen kalkar ve kullanıcı bunu fark etmez.
   * Makul aralık dışındaki yıl null döndürür ki çağıran açık hata versin.
   */
  const YIL_ALT = 2000;
  function yilUst() { return new Date().getFullYear() + 1; }

  function ayaCevir(v) {
    const s = metin(v).trim();
    if (!s) return '';

    let yil = null, ay = null, m;

    if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) { yil = m[1]; ay = m[2]; }
    else if ((m = s.match(/^(\d{1,2})[.\/\-](\d{4})$/))) { ay = m[1]; yil = m[2]; }
    else if ((m = s.match(/^(\d{4})[.\/\-](\d{1,2})$/))) { yil = m[1]; ay = m[2]; }
    else if ((m = s.match(/^(\d{6})$/))) {
      // 6 hane: baştaki 4 hane geçerli bir yılsa YYYYAA, değilse AAYYYY
      const bas4 = parseInt(s.slice(0, 4), 10);
      if (bas4 >= YIL_ALT && bas4 <= yilUst()) { yil = s.slice(0, 4); ay = s.slice(4); }
      else { ay = s.slice(0, 2); yil = s.slice(2); }
    }

    if (!yil) return null;
    const y = parseInt(yil, 10);
    if (!(y >= YIL_ALT && y <= yilUst())) return null;
    const a = parseInt(ay, 10);
    if (!(a >= 1 && a <= 12)) return null;
    return yil + String(a).padStart(2, '0');
  }

  /*
   * Panelin "AA.YYYY" maskesi. Ham girdiden gösterilecek değeri üretir.
   * Tam tarih girildiğinde (01.06.2026) ay+yıl DOĞRU çıkarılır; 6 haneden
   * fazlası sessizce kırpılmaz, çağıran kullanıcıyı uyarabilsin diye bildirilir.
   */
  function ayMaskesi(ham) {
    let d = metin(ham).replace(/\D/g, '');
    let uyari = '';

    if (d.length > 6) {
      if (d.length === 8) {
        // gg.aa.yyyy veya yyyy.aa.gg -> aa + yyyy
        const bas4 = parseInt(d.slice(0, 4), 10);
        d = (bas4 >= YIL_ALT && bas4 <= yilUst())
          ? (d.slice(4, 6) + d.slice(0, 4))
          : (d.slice(2, 4) + d.slice(4));
        uyari = 'Tam tarih girildi; ay ve yıl alındı.';
      } else {
        d = d.slice(0, 6);
        uyari = 'Ay alanı AA.YYYY biçimindedir; fazla haneler kullanılmadı.';
      }
    }

    return {
      deger: (d.length > 2) ? (d.slice(0, 2) + '.' + d.slice(2)) : d,
      uyari: uyari
    };
  }

  /* "202604" -> "04.2026" (panelde göstermek için) */
  function aydanMetne(v) {
    const m = metin(v).match(/^(\d{4})(\d{2})$/);
    return m ? m[2] + '.' + m[1] : '';
  }

  /*
   * Şirket unvanlarını dosya adında kullanılabilecek kadar kısaltır.
   * "DENEME OTOMOTİV SANAYİ VE TİCARET ANONİM ŞİRKETİ" -> "DENEME OTO. SAN. TİC. A.Ş."
   * Gerçek kişilerde (ad soyad) hiçbir şey değişmez.
   */
  const COKLU_KISALTMA = [
    ['ANONİM ŞİRKETİ', 'A.Ş.'], ['ANONIM SIRKETI', 'A.Ş.'], ['ANONİM ŞİRKET', 'A.Ş.'],
    ['LİMİTED ŞİRKETİ', 'LTD.ŞTİ.'], ['LIMITED SIRKETI', 'LTD.ŞTİ.'], ['LİMİTED ŞİRKET', 'LTD.ŞTİ.'],
    ['KOLLEKTİF ŞİRKETİ', 'KOLL.ŞTİ.'], ['KOMANDİT ŞİRKETİ', 'KOM.ŞTİ.'],
    ['SANAYİ VE TİCARET', 'SAN. TİC.'], ['SANAYI VE TICARET', 'SAN. TİC.'],
    ['TİCARET VE SANAYİ', 'TİC. SAN.'],
    ['İTHALAT VE İHRACAT', 'İTH. İHR.'], ['İTHALAT İHRACAT', 'İTH. İHR.']
  ];
  const TEKIL_KISALTMA = {
    'SANAYİ': 'SAN.', 'SANAYI': 'SAN.', 'TİCARET': 'TİC.', 'TICARET': 'TİC.',
    'İTHALAT': 'İTH.', 'ITHALAT': 'İTH.', 'İHRACAT': 'İHR.', 'IHRACAT': 'İHR.',
    'PAZARLAMA': 'PAZ.', 'MÜHENDİSLİK': 'MÜH.', 'İNŞAAT': 'İNŞ.', 'INSAAT': 'İNŞ.',
    'NAKLİYAT': 'NAK.', 'TAŞIMACILIK': 'TAŞ.', 'OTOMOTİV': 'OTO.', 'TURİZM': 'TUR.',
    'DANIŞMANLIK': 'DAN.', 'MÜŞAVİRLİK': 'MÜŞ.', 'HİZMETLERİ': 'HİZ.', 'HİZMET': 'HİZ.',
    'ORGANİZASYON': 'ORG.', 'ELEKTRİK': 'ELK.', 'ELEKTRONİK': 'ELN.',
    'MADENCİLİK': 'MAD.', 'TEKSTİL': 'TEKS.', 'ÜRÜNLERİ': 'ÜR.', 'VE': ''
  };

  function kisaltUnvan(ad, enFazla) {
    let s = metin(ad).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    try { s = s.toLocaleUpperCase('tr-TR'); } catch (_) { s = s.toUpperCase(); }

    for (let i = 0; i < COKLU_KISALTMA.length; i++) {
      s = s.split(COKLU_KISALTMA[i][0]).join(COKLU_KISALTMA[i][1]);
    }
    s = s.split(' ').map(function (t) {
      return TEKIL_KISALTMA.hasOwnProperty(t) ? TEKIL_KISALTMA[t] : t;
    }).filter(Boolean).join(' ');

    s = s.replace(/\s{2,}/g, ' ').trim();

    // Şirket türü (A.Ş. / LTD.ŞTİ. …) ayırt edici olduğu için kısaltmada korunur.
    let son = '';
    const FORMLAR = ['A.Ş.', 'LTD.ŞTİ.', 'KOLL.ŞTİ.', 'KOM.ŞTİ.'];
    for (let i = 0; i < FORMLAR.length; i++) {
      const f = FORMLAR[i];
      if (s.length > f.length + 1 && s.slice(-(f.length + 1)) === (' ' + f)) {
        son = f;
        s = s.slice(0, -(f.length + 1)).trim();
        break;
      }
    }

    const sinir = enFazla || 40;
    if (s.length > sinir) {
      s = s.slice(0, sinir);
      const bosluk = s.lastIndexOf(' ');
      if (bosluk > 10) s = s.slice(0, bosluk);
      s = s.replace(/[\s,\-]+$/, '');   // sondaki noktayı koru (SAN. gibi)
    }
    return son ? (s + ' ' + son) : s;
  }

  function damga() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* Dosya adında kullanılamayacak karakterleri temizler */
  function dosyaAdiTemizle(s) {
    return metin(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /* Basit olay duyurusu — modüller arayüze bağımlı olmasın diye */
  const dinleyiciler = [];
  function abone(f) { dinleyiciler.push(f); }
  function bildir(tur, mesaj) {
    for (let i = 0; i < dinleyiciler.length; i++) {
      try { dinleyiciler[i](tur, mesaj); } catch (_) {}
    }
  }

  return {
    bekle: bekle,
    tarihCoz: tarihCoz,
    sayiCoz: sayiCoz,
    metin: metin,
    ayaCevir: ayaCevir,
    ayMaskesi: ayMaskesi,
    aydanMetne: aydanMetne,
    kisaltUnvan: kisaltUnvan,
    damga: damga,
    dosyaAdiTemizle: dosyaAdiTemizle,
    abone: abone,
    bildir: bildir
  };
})();

/* ==================== 20-ag-kancasi.js ==================== */
/*
 * Ağ kancası — sayfanın KENDİ isteklerinden oturum başlıklarını öğrenir.
 *
 * Neden gerekli: Dijital Vergi Dairesi API'si `Authorization` başlığı ister.
 * Bu başlığı hiçbir yerde saklamıyoruz, tahmin de etmiyoruz; sayfa zaten her
 * istekte gönderiyor, biz en sonuncusunu hafızada tutup aynısıyla çağrı yapıyoruz.
 * Böylece ayrı giriş/şifre gerekmez ve oturum yenilendiğinde otomatik uyum sağlanır.
 */

const Kanca = (function () {

  const ILGILI = '/apigateway/';
  const ATLANACAK = /^(content-length|host|origin|referer|connection|cookie)$/i;

  let sonBasliklar = null;
  let sonGorulme = 0;

  function nesneyeCevir(h) {
    const o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === 'function' && !Array.isArray(h)) {
        h.forEach(function (v, k) { o[String(k)] = String(v); });
      } else if (Array.isArray(h)) {
        for (let i = 0; i < h.length; i++) o[String(h[i][0])] = String(h[i][1]);
      } else if (typeof h === 'object') {
        const ks = Object.keys(h);
        for (let i = 0; i < ks.length; i++) o[ks[i]] = String(h[ks[i]]);
      }
    } catch (_) {}
    return o;
  }

  function ogren(url, basliklar) {
    try {
      if (!url || String(url).indexOf(ILGILI) === -1) return;
      const ks = Object.keys(basliklar || {});
      let authVar = false;
      for (let i = 0; i < ks.length; i++) {
        if (ks[i].toLowerCase() === 'authorization') { authVar = true; break; }
      }
      if (!authVar) return;

      const temiz = {};
      for (let i = 0; i < ks.length; i++) {
        if (ATLANACAK.test(ks[i])) continue;
        temiz[ks[i]] = basliklar[ks[i]];
      }
      sonBasliklar = temiz;
      sonGorulme = Date.now();
    } catch (_) {}
  }

  /* ---- fetch ---- */
  const fetchOrj = window.fetch;
  if (typeof fetchOrj === 'function') {
    window.fetch = function (girdi, ayar) {
      try {
        const istekNesnesi = (girdi && typeof girdi === 'object' && 'url' in girdi) ? girdi : null;
        const url = istekNesnesi ? istekNesnesi.url : String(girdi);
        const basliklar = Object.assign(
          {},
          istekNesnesi ? nesneyeCevir(istekNesnesi.headers) : {},
          nesneyeCevir(ayar && ayar.headers)
        );
        ogren(url, basliklar);
      } catch (_) {}
      return fetchOrj.apply(this, arguments);
    };
  }

  /* ---- XMLHttpRequest (Angular HttpClient bunu kullanır) ---- */
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const openOrj = XHR.prototype.open;
    const sendOrj = XHR.prototype.send;
    const setHOrj = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      try { this.__gibUrl = String(url); this.__gibBaslik = {}; } catch (_) {}
      return openOrj.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (ad, deger) {
      try { if (this.__gibBaslik) this.__gibBaslik[String(ad)] = String(deger); } catch (_) {}
      return setHOrj.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try { ogren(this.__gibUrl, this.__gibBaslik); } catch (_) {}
      return sendOrj.apply(this, arguments);
    };
  }

  /* İkinci kaynak: uygulama oturum anahtarını sessionStorage'da da tutuyor.
     Sayfa henüz hiç istek atmamışsa (panel her sayfada açılabildiği için olabilir)
     buradan okunur. Başlık biçimi "Bearer <token>". */
  function depodanBaslik() {
    try {
      const t = sessionStorage.getItem('token');
      if (!t) return null;
      return { 'Authorization': /^Bearer\s/i.test(t) ? t : ('Bearer ' + t) };
    } catch (_) {
      return null;
    }
  }

  function hazirMi() { return !!(sonBasliklar || depodanBaslik()); }

  function basliklar() {
    // Sayfanın kendi gönderdiği başlıklar birebir kopyalanır; yoksa depodaki anahtar.
    const kaynak = sonBasliklar || depodanBaslik() || {};
    return Object.assign({
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json'
    }, kaynak);
  }

  /* Sayfa açılışında birkaç apigateway isteği zaten atılıyor; token birkaç
     yüz ms içinde gelir. Yine de gelmezse kullanıcıya net bir mesaj verilir. */
  async function hazirBekle(zamanAsimiMs) {
    const bitis = Date.now() + (zamanAsimiMs || 15000);
    while (!hazirMi() && Date.now() < bitis) await Yard.bekle(250);
    if (!hazirMi()) {
      throw new Error(
        'Oturum bilgisi bulunamadı. Dijital Vergi Dairesi\'ne giriş yaptıktan sonra ' +
        'sayfayı F5 ile yenileyip tekrar deneyin.'
      );
    }
    return true;
  }

  function yas() { return sonGorulme ? Date.now() - sonGorulme : null; }

  return {
    hazirMi: hazirMi,
    hazirBekle: hazirBekle,
    basliklar: basliklar,
    yas: yas
  };
})();

/* ==================== 30-istemci.js ==================== */
/*
 * API istemcisi — istekleri sıraya koyar, hız sınırlar, sayfalamayı yönetir.
 *
 * NEZAKET KURALI: bu bir devlet sunucusu. İstekler sıralı atılır (eşzamanlı değil),
 * aralarında en az GECIKME_MS bekleme vardır ve hata durumunda üstel geri çekilme
 * uygulanır. Kullanıcı her an İptal edebilir.
 */

const Istemci = (function () {

  const TABAN = location.origin + '/apigateway/api/tahsilat-bilgilerim/';
  /* GİB'in servis istek limiti var. Hız burada bilinçli olarak düşük tutulur;
     limite takılmak, hızlı bitirmekten çok daha maliyetli. */
  const GECIKME_MS = 600;
  const EN_FAZLA_SAYFA = 500;   // sonsuz döngüye karşı emniyet

  /* Sunucu "servis istek limitine ulaşıldı" derse ısrar etmek durumu kötüleştirir:
     hemen dur, elde olanı koru, kullanıcıya beklemesini söyle. */
  const LIMIT_DESENI = /limit|kota|too\s*many|çok\s*fazla\s*istek|yoğunluk/i;

  function limitHatasi(ayrinti) {
    const e = new Error(
      'GİB servis istek limitine ulaşıldı' + (ayrinti ? ' (' + ayrinti + ')' : '') +
      '. Birkaç dakika bekleyip tekrar deneyin; o ana kadar toplananlar korundu.'
    );
    e.limit = true;
    return e;
  }

  let iptalIstendi = false;
  let sonIstek = 0;

  function iptalEt() { iptalIstendi = true; }
  function sifirla() { iptalIstendi = false; }
  function iptalMi() { return iptalIstendi; }

  function iptalKontrol() {
    if (iptalIstendi) {
      const e = new Error('İşlem iptal edildi.');
      e.iptal = true;
      throw e;
    }
  }

  /*
   * Sıra bekle. Slot PEŞİN rezerve edilir: iki akış aynı anda beklemeye
   * girerse aynı boş milisaniyeyi hesaplayıp aynı anda istek atmasın.
   * (Rezervasyon olmadan "sıralı istek" garantisi yalnızca kâğıt üstünde kalır.)
   */
  async function nezaketBekle() {
    const simdi = Date.now();
    const slot = Math.max(simdi, sonIstek + GECIKME_MS);
    sonIstek = slot;
    if (slot > simdi) await Yard.bekle(slot - simdi);
  }

  function sunucuMesaji(veri) {
    const m = veri && veri.messages;
    if (!m) return '';
    if (Array.isArray(m)) {
      return m.map(function (x) {
        if (!x) return '';
        return x.text || x.mesaj || x.message || x.aciklama || JSON.stringify(x);
      }).filter(Boolean).join(' | ');
    }
    return typeof m === 'string' ? m : JSON.stringify(m);
  }

  /*
   * Ham yanıt döndürür (gövdeyi okumaz). PDF gibi ikili yanıtlar için gerekli.
   * Hız sınırlama, yeniden deneme ve oturum denetimi burada yapılır.
   */
  async function ham(yol, govde, denemeler) {
    denemeler = denemeler || 3;

    for (let deneme = 1; deneme <= denemeler; deneme++) {
      iptalKontrol();
      await nezaketBekle();

      let yanit;
      try {
        yanit = await fetch(TABAN + yol, {
          method: 'POST',
          headers: Kanca.basliklar(),
          body: JSON.stringify(govde),
          credentials: 'include'
        });
      } catch (e) {
        if (deneme === denemeler) throw new Error('Ağ hatası: ' + (e && e.message ? e.message : e));
        Yard.bildir('uyari', 'Ağ hatası, tekrar deneniyor (' + deneme + '/' + denemeler + ')…');
        await Yard.bekle(800 * deneme);
        continue;
      }

      if (yanit.status === 401 || yanit.status === 403) {
        const e = new Error(
          'Oturum geçersiz (HTTP ' + yanit.status + '). Sayfayı F5 ile yenileyip ' +
          'tekrar giriş yaptıktan sonra deneyin.'
        );
        e.oturum = true;
        throw e;
      }

      if (yanit.status === 429) {
        /* Bir kez, uzun bekleyerek denenir; ısrar edilmez.
           `deneme >= denemeler` şartı ŞART: denemeler=1 ile çağrıldığında
           aksi hâlde döngü return'süz biter, fonksiyon undefined döner ve
           .limit bayrağı kaybolur — panel "kayıt yok" sanır. */
        if (deneme >= 2 || deneme >= denemeler) throw limitHatasi('HTTP 429');
        Yard.bildir('uyari', 'Sunucu istek sınırı uyarısı verdi, 5 saniye beklenip bir kez denenecek…');
        await Yard.bekle(5000);
        continue;
      }

      if (yanit.status >= 500) {
        if (deneme >= denemeler) throw new Error('Sunucu şu an yanıt vermiyor (HTTP ' + yanit.status + ').');
        Yard.bildir('uyari', 'Sunucu meşgul (HTTP ' + yanit.status + '), bekleyip tekrar denenecek…');
        await Yard.bekle(1500 * deneme);
        continue;
      }

      if (!yanit.ok) {
        // Durum kodu çağırana taşınır: yıl taraması "desteklenmeyen yıl" (400)
        // ile gerçek arızayı ayırt edebilsin.
        const e = new Error('Beklenmeyen yanıt: HTTP ' + yanit.status);
        e.durum = yanit.status;
        throw e;
      }
      return yanit;
    }

    // Buraya düşmemeli; düşerse sessiz undefined yerine açık hata ver.
    throw new Error('İstek tamamlanamadı (' + denemeler + ' deneme).');
  }

  /*
   * Serbest adresten GET. Alındı PDF'i iki adımlı geliyor: önce uç nokta bir
   * `reportLink` veriyor, PDF o adresten indiriliyor. O ikinci istek de aynı
   * nezaket ve hata kurallarına tabi olsun diye buradan geçer.
   */
  async function getHam(url, denemeler) {
    denemeler = denemeler || 2;
    for (let deneme = 1; deneme <= denemeler; deneme++) {
      iptalKontrol();
      await nezaketBekle();

      let yanit;
      try {
        yanit = await fetch(url, { method: 'GET', credentials: 'include' });
      } catch (e) {
        if (deneme === denemeler) throw new Error('Ağ hatası: ' + (e && e.message ? e.message : e));
        await Yard.bekle(800 * deneme);
        continue;
      }

      if (yanit.status === 401 || yanit.status === 403) {
        const e = new Error('Oturum geçersiz (HTTP ' + yanit.status + ').');
        e.oturum = true;
        throw e;
      }
      if (yanit.status === 429) throw limitHatasi('HTTP 429');
      if (yanit.status >= 500) {
        if (deneme >= denemeler) throw new Error('Sunucu yanıt vermiyor (HTTP ' + yanit.status + ').');
        await Yard.bekle(1500 * deneme);
        continue;
      }
      if (!yanit.ok) {
        const e = new Error('Beklenmeyen yanıt: HTTP ' + yanit.status);
        e.durum = yanit.status;
        throw e;
      }
      return yanit;
    }

    throw new Error('İstek tamamlanamadı (' + denemeler + ' deneme).');
  }

  async function istek(yol, govde, denemeler) {
    const yanit = await ham(yol, govde, denemeler);

    let veri;
    try {
      veri = await yanit.json();
    } catch (e) {
      throw new Error('Sunucu yanıtı okunamadı (geçerli JSON değil).');
    }

    // Limit uyarısı HTTP 200 ile de gelebiliyor; gövdedeki mesaj denetlenir.
    const mesaj = sunucuMesaji(veri);
    if (mesaj) {
      if (LIMIT_DESENI.test(mesaj)) throw limitHatasi(mesaj);
      Yard.bildir('uyari', 'Sunucu mesajı: ' + mesaj);
    }

    return veri;
  }

  /*
   * Sayfalı uç noktaların tamamını gezer.
   * Döngü, İSTEDİĞİMİZ sayfa boyutuna değil, yanıttaki pageDetail'e göre kurulur —
   * sunucu pageSize'ı kısıtlarsa da doğru çalışır.
   */
  async function tumSayfalar(yol, govdeYapici, secenekler) {
    secenekler = secenekler || {};
    const sayfaBoyutu = secenekler.sayfaBoyutu || 100;
    const hepsi = [];
    let sayfa = 1;

    while (sayfa <= EN_FAZLA_SAYFA) {
      iptalKontrol();
      const veri = await istek(yol, govdeYapici(sayfa, sayfaBoyutu));

      if (sayfa === 1 && typeof secenekler.ilkYanit === 'function') {
        try { secenekler.ilkYanit(veri); } catch (_) {}
      }

      const liste = (veri && veri.dataList) || [];
      for (let i = 0; i < liste.length; i++) hepsi.push(liste[i]);

      if (typeof secenekler.ilerleme === 'function') {
        const pd0 = (veri && veri.pageDetail) || {};
        try { secenekler.ilerleme(hepsi.length, Number(pd0.total) || hepsi.length); } catch (_) {}
      }

      const pd = (veri && veri.pageDetail) || {};
      const toplamSayfa = Number(pd.totalPage);
      if (isFinite(toplamSayfa) && toplamSayfa > 0) {
        if (sayfa >= toplamSayfa) break;
      } else {
        const gercekBoyut = Number(pd.pageSize) || sayfaBoyutu;
        if (liste.length < gercekBoyut) break;
      }
      sayfa++;
    }

    if (sayfa > EN_FAZLA_SAYFA) {
      Yard.bildir('uyari', 'Sayfa sınırına (' + EN_FAZLA_SAYFA + ') ulaşıldı, kalanlar alınmadı.');
    }
    return hepsi;
  }

  return {
    ham: ham,
    getHam: getHam,
    istek: istek,
    tumSayfalar: tumSayfalar,
    iptalEt: iptalEt,
    sifirla: sifirla,
    iptalMi: iptalMi,
    iptalKontrol: iptalKontrol
  };
})();

/* ==================== 35-zip.js ==================== */
/*
 * Küçük ZIP yazıcısı (sıkıştırmasız / "store").
 *
 * İki yerde kullanılıyor:
 *   - .xlsx üretimi (xlsx zaten içinde XML olan bir ZIP'tir)
 *   - alındı PDF'lerini tek dosyada toplu indirme
 *
 * Sıkıştırma yok çünkü gerek yok: XML küçük, PDF zaten sıkıştırılmış.
 * Store yöntemi ZIP standardında geçerlidir; Excel ve Windows sorunsuz açar.
 */

const Zip = (function () {

  const crcTablo = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bayt) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bayt.length; i++) c = crcTablo[(c ^ bayt[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const kodlayici = new TextEncoder();
  function utf8(s) { return kodlayici.encode(s); }

  /* dosyalar: [{ad, veri:Uint8Array}] -> Blob */
  function olustur(dosyalar, mimeTipi) {
    const parcalar = [];
    const merkez = [];
    let ofset = 0;

    for (let i = 0; i < dosyalar.length; i++) {
      const ad = utf8(dosyalar[i].ad);
      const veri = dosyalar[i].veri;
      const crc = crc32(veri);

      const yerel = new Uint8Array(30 + ad.length);
      const yv = new DataView(yerel.buffer);
      yv.setUint32(0, 0x04034b50, true);   // yerel başlık imzası
      yv.setUint16(4, 20, true);           // gereken sürüm
      yv.setUint16(6, 0x0800, true);       // UTF-8 bayrağı
      yv.setUint16(8, 0, true);            // yöntem 0 = store
      yv.setUint16(10, 0, true);           // saat
      yv.setUint16(12, 0x0021, true);      // tarih = 1980-01-01
      yv.setUint32(14, crc, true);
      yv.setUint32(18, veri.length, true);
      yv.setUint32(22, veri.length, true);
      yv.setUint16(26, ad.length, true);
      yv.setUint16(28, 0, true);
      yerel.set(ad, 30);
      parcalar.push(yerel, veri);

      const m = new Uint8Array(46 + ad.length);
      const mv = new DataView(m.buffer);
      mv.setUint32(0, 0x02014b50, true);   // merkez dizin imzası
      mv.setUint16(4, 20, true);
      mv.setUint16(6, 20, true);
      mv.setUint16(8, 0x0800, true);
      mv.setUint16(10, 0, true);
      mv.setUint16(12, 0, true);
      mv.setUint16(14, 0x0021, true);
      mv.setUint32(16, crc, true);
      mv.setUint32(20, veri.length, true);
      mv.setUint32(24, veri.length, true);
      mv.setUint16(28, ad.length, true);
      mv.setUint32(42, ofset, true);
      m.set(ad, 46);
      merkez.push(m);

      ofset += yerel.length + veri.length;
    }

    let merkezBoyut = 0;
    for (let i = 0; i < merkez.length; i++) merkezBoyut += merkez[i].length;

    const son = new Uint8Array(22);
    const sv = new DataView(son.buffer);
    sv.setUint32(0, 0x06054b50, true);
    sv.setUint16(8, dosyalar.length, true);
    sv.setUint16(10, dosyalar.length, true);
    sv.setUint32(12, merkezBoyut, true);
    sv.setUint32(16, ofset, true);

    return new Blob(parcalar.concat(merkez, [son]), { type: mimeTipi || 'application/zip' });
  }

  function indir(blob, dosyaAdi) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dosyaAdi;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  return { olustur: olustur, indir: indir, utf8: utf8 };
})();

/* ==================== 40-xlsx.js ==================== */
/*
 * Küçük ve bağımsız .xlsx yazıcısı.
 *
 * Neden hazır kütüphane kullanmıyoruz: script'in internetten hiçbir şey
 * indirmemesi gerekiyor (kapalı ofis ağlarında CDN engelli olabiliyor) ve
 * dosyanın tek parça kalması gerekiyor. Gereken kısım küçük: xlsx aslında
 * içinde XML dosyaları olan bir ZIP. Sıkıştırmasız (store) ZIP de geçerlidir.
 *
 * Hücre tipleri: 'metin' | 'sayi' | 'tam' | 'tarih'
 *   metin -> satır içi metin (uzun numaralar bilimsel gösterime dönmez)
 *   sayi  -> gerçek sayı, #,##0.00  (Excel'de SUM çalışır)
 *   tam   -> gerçek tam sayı
 *   tarih -> gerçek tarih, gg.aa.yyyy
 */

const Xlsx = (function () {

  const utf8 = Zip.utf8;

  /* Bu sayının üzerinde tek seferde Excel üretmek belleği zorlayabilir. */
  const SATIR_UYARI_SINIRI = 50000;

  /* ------------------------------------------------------------ XML */
  function xmlKac(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sutunHarfi(n) {
    let s = '';
    while (n > 0) {
      const k = (n - 1) % 26;
      s = String.fromCharCode(65 + k) + s;
      n = (n - k - 1) / 26;
    }
    return s;
  }

  /* Excel tarih serisi (1899-12-30 başlangıçlı) */
  function tarihSerisi(d) {
    const gun = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((gun - Date.UTC(1899, 11, 30)) / 86400000);
  }

  /* Stil indeksleri: 0 metin · 1 sayı · 2 tam · 3 tarih · 4 başlık */
  const STIL = { metin: 0, sayi: 1, tam: 2, tarih: 3, baslik: 4 };

  const BILDIRIM =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const ICERIK_TIPLERI = BILDIRIM +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const KOK_ILISKILER = BILDIRIM +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const KITAP_ILISKILER = BILDIRIM +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const STILLER = BILDIRIM +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2">' +
      '<numFmt numFmtId="164" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="166" formatCode="dd\\.mm\\.yyyy"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1B3358"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
        '<alignment vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function sayfaAdiTemizle(ad) {
    return (String(ad || 'Sayfa1').replace(/[\[\]\*\?\/\\:]/g, ' ').trim() || 'Sayfa1').slice(0, 31);
  }

  function kitapXml(sayfaAdi) {
    return BILDIRIM +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlKac(sayfaAdiTemizle(sayfaAdi)) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';
  }

  function hucre(adres, deger, tip) {
    if (deger === null || deger === undefined || deger === '') return '';

    if (tip === 'sayi' || tip === 'tam') {
      const n = (typeof deger === 'number') ? deger : Yard.sayiCoz(deger);
      if (n === null) return '<c r="' + adres + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlKac(deger) + '</t></is></c>';
      return '<c r="' + adres + '" s="' + STIL[tip] + '"><v>' + n + '</v></c>';
    }

    if (tip === 'tarih') {
      const d = (deger instanceof Date) ? deger : Yard.tarihCoz(deger);
      if (!d) return '<c r="' + adres + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlKac(deger) + '</t></is></c>';
      return '<c r="' + adres + '" s="' + STIL.tarih + '"><v>' + tarihSerisi(d) + '</v></c>';
    }

    return '<c r="' + adres + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlKac(deger) + '</t></is></c>';
  }

  function sayfaXml(sutunlar, satirlar) {
    const sonSutun = sutunHarfi(sutunlar.length);
    const parca = [];

    parca.push(BILDIRIM);
    parca.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    parca.push('<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>');
    parca.push('<sheetFormatPr defaultRowHeight="15"/>');

    parca.push('<cols>');
    for (let i = 0; i < sutunlar.length; i++) {
      const g = sutunlar[i].genislik || 16;
      parca.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + g + '" customWidth="1"/>');
    }
    parca.push('</cols>');

    parca.push('<sheetData>');

    // başlık satırı
    parca.push('<row r="1" ht="30" customHeight="1">');
    for (let i = 0; i < sutunlar.length; i++) {
      parca.push('<c r="' + sutunHarfi(i + 1) + '1" s="' + STIL.baslik + '" t="inlineStr">' +
        '<is><t xml:space="preserve">' + xmlKac(sutunlar[i].ad) + '</t></is></c>');
    }
    parca.push('</row>');

    // veri satırları
    for (let s = 0; s < satirlar.length; s++) {
      const satirNo = s + 2;
      parca.push('<row r="' + satirNo + '">');
      for (let i = 0; i < sutunlar.length; i++) {
        parca.push(hucre(sutunHarfi(i + 1) + satirNo, satirlar[s][i], sutunlar[i].tip || 'metin'));
      }
      parca.push('</row>');
    }

    parca.push('</sheetData>');
    parca.push('<autoFilter ref="A1:' + sonSutun + Math.max(1, satirlar.length + 1) + '"/>');
    parca.push('</worksheet>');

    return parca.join('');
  }

  /*
   * olustur({ sayfaAdi, sutunlar:[{ad,tip,genislik}], satirlar:[[deger,…]] }) -> Blob
   */
  function olustur(secenekler) {
    const sutunlar = secenekler.sutunlar || [];
    const satirlar = secenekler.satirlar || [];
    if (!sutunlar.length) throw new Error('Excel için en az bir sütun gerekli.');

    if (satirlar.length > SATIR_UYARI_SINIRI) {
      Yard.bildir('uyari', satirlar.length.toLocaleString('tr-TR') +
        ' satır tek dosyada üretiliyor; tarayıcı zorlanabilir. Sorguyu yıl bazında ' +
        'bölmeniz önerilir.');
    }

    return Zip.olustur([
      { ad: '[Content_Types].xml',      veri: utf8(ICERIK_TIPLERI) },
      { ad: '_rels/.rels',              veri: utf8(KOK_ILISKILER) },
      { ad: 'xl/workbook.xml',          veri: utf8(kitapXml(secenekler.sayfaAdi)) },
      { ad: 'xl/_rels/workbook.xml.rels', veri: utf8(KITAP_ILISKILER) },
      { ad: 'xl/styles.xml',            veri: utf8(STILLER) },
      { ad: 'xl/worksheets/sheet1.xml', veri: utf8(sayfaXml(sutunlar, satirlar)) }
    ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  return {
    olustur: olustur,
    indir: Zip.indir,
    tarihSerisi: tarihSerisi,
    sutunHarfi: sutunHarfi
  };
})();

/* ==================== 60-arayuz.js ==================== */
/*
 * Yüzen panel.
 *
 * Sitenin HER sayfasında sağ altta küçük bir düğme olarak durur; tıklanınca açılır.
 * İlgili GİB ekranına gitmeye gerek yoktur, sorgu doğrudan panelden yapılır.
 *
 * Panel ekranlardan bağımsızdır: alanlar, veri toplama, özet ve Excel üretimi
 * kayıtlı "ekran" nesnelerinden gelir.
 *
 * Panel yüksekliği sabit tutulur: ilerleme tek satır, ayrıntı kaydı katlanır.
 * Çekim yarıda kesilse (Durdur) veya hata alsa bile o ana kadar toplananlar
 * korunur ve ayrıca dışa aktarılabilir.
 */

const Arayuz = (function () {

  const KOK_ID = 'gib-tahsilat-excel-kok';
  const BASLIK = 'GİB - Sorgulama Paneli';

  let golge = null;
  let ekranlar = [];
  let aktifEkran = null;
  let calisiyor = false;
  let filtrelerYuklendi = false;
  /* Uçuştaki filtre yükleme sözü — aynı yükleme ikinci kez başlamasın. */
  let filtreYukleniyor = null;
  /*
   * Çalışma jetonu. sifirla() senkron çalışır ama çalışan sorgu bir `await`
   * üzerindedir; iptal istisnası sifirla'dan SONRA yakalanır ve ekranı yeniden
   * boyar. Jeton olmadan önceki mükellefin özeti yeni mükellefin panelinde
   * görünür. Her akış başında jeton alınır, sifirla() jetonu geçersizleştirir.
   */
  let calismaNo = 0;
  /* araDoldur bir seçimi kendiliğinden sıfırlarsa mesajı durum satırına taşır. */
  let secimSifirlandi = '';
  /* Son sorgunun sonucu: tamam=false ise çekim yarıda kalmıştır. */
  let bekleyen = { kayitlar: [], baglam: null, tamam: false };
  /* Panel (SPA gövdeyi silerse) yeniden kurulabiliyor; belge düzeyindeki
     dinleyiciler ve olay aboneliği yalnızca BİR kez bağlanmalı — yoksa her
     kurulumda birikip kayıtların tekrar tekrar yazılmasına yol açar. */
  let genelBaglandi = false;

  /* Aranabilir açılır listelerin durumu: anahtar -> {coklu, secili[], secenekler[]} */
  const ara = {};

  const BICIM = `
    *{box-sizing:border-box;font-family:Segoe UI,Tahoma,sans-serif}
    .sarmal{display:flex;flex-direction:column;align-items:flex-end;gap:8px}

    .pill{display:flex;align-items:center;gap:7px;background:#12203a;color:#e8eefc;
          border:1px solid #2c4a7a;border-radius:22px;padding:9px 15px;font-size:12.5px;
          font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)}
    .pill:hover{background:#1b3358}
    .pill .nokta{width:8px;height:8px;border-radius:50%;background:#38d47a}

    .kutu{width:376px;max-height:88vh;display:flex;flex-direction:column;
          background:#12203a;color:#e8eefc;border:1px solid #2c4a7a;border-radius:10px;
          box-shadow:0 10px 32px rgba(0,0,0,.5)}
    .bas{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1b3358;
         font-weight:600;font-size:13px;flex:0 0 auto;cursor:move;user-select:none;
         border-radius:9px 9px 0 0}
    .nokta{width:9px;height:9px;border-radius:50%;background:#38d47a;flex:0 0 auto}
    .kapat{margin-left:auto;background:transparent;border:0;color:#9fb3d4;font-size:17px;
           cursor:pointer;padding:0 4px;line-height:1}
    .gov{padding:12px;overflow:auto;font-size:12px}

    .kimlik{font-size:12px;color:#cfe0fb;background:#0b1526;border-radius:6px;
            padding:7px 9px;margin-bottom:10px;line-height:1.4}
    .kimlik span{color:#8fa6c6}

    .izgara{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}
    .alan{display:flex;flex-direction:column;gap:3px;min-width:0}
    .alan.genis{grid-column:1 / -1}
    label{font-size:11px;color:#9fb3d4}
    label i{font-style:normal;opacity:.75}
    input,select{background:#0b1526;color:#e8eefc;border:1px solid #2c4a7a;border-radius:5px;
                 padding:5px 6px;font-size:12px;width:100%;min-width:0}
    input:focus,select:focus{outline:2px solid #2f80ed;outline-offset:-1px}
    .alanAksiyon{margin-top:2px}
    .alanAksiyon button{background:none;border:0;color:#7fb0f0;font-size:11px;cursor:pointer;
                        padding:0;text-decoration:underline}
    .alanAksiyon button:disabled{opacity:.45;cursor:not-allowed;text-decoration:none}

    /* Ay-yıl alanı: "06.2026" maskeli metin + takvim düğmesi */
    .ayKutu{position:relative;display:block}
    .ayKutu input.ayMetin{padding-right:28px;letter-spacing:.5px}
    .takvimDugme{position:absolute;right:2px;top:50%;transform:translateY(-50%);
                 background:transparent;border:0;cursor:pointer;padding:3px;display:flex;
                 align-items:center;color:#9fb3d4;border-radius:4px}
    .takvimDugme:hover{background:#1b3358;color:#e8eefc}
    .gizliAy{position:absolute;right:6px;bottom:0;width:1px;height:1px;padding:0;border:0;
             opacity:0;pointer-events:none}

    /* Aranabilir açılır liste */
    .ara{position:relative}
    .araAlan{display:flex;align-items:center;gap:6px;width:100%;background:#0b1526;
             color:#e8eefc;border:1px solid #2c4a7a;border-radius:5px;padding:5px 6px;
             font-size:12px;cursor:pointer;text-align:left}
    .araAlan span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .araAlan i{font-style:normal;color:#7f93b4;font-size:10px}
    .araAlan:hover{border-color:#3d6199}
    .araPop{position:absolute;z-index:5;left:0;right:0;top:calc(100% + 3px);background:#0e1b31;
            border:1px solid #3d6199;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.5);
            padding:6px;display:flex;flex-direction:column;gap:5px}
    .araGiris{padding:5px 6px;font-size:12px}
    .araListe{max-height:168px;overflow:auto;display:flex;flex-direction:column}
    .araSatir{padding:5px 7px;border-radius:4px;cursor:pointer;font-size:12px;line-height:1.3;
              white-space:normal;word-break:break-word}
    .araSatir:hover{background:#1b3358}
    .araSatir.secili{background:#22497f;color:#fff}
    .araSatir.secili::before{content:'✓ ';color:#7fd4ff}
    .araBos{padding:6px 7px;color:#7f93b4;font-size:11.5px}
    .araAlt{font-size:10.5px;color:#7f93b4;border-top:1px solid #22375c;padding-top:5px}

    .ayrac{height:1px;background:#2c4a7a;margin:11px 0}
    .dugmeler{display:flex;flex-wrap:wrap;gap:6px}
    button.d{flex:1 1 100%;padding:9px 6px;border:0;border-radius:6px;font-size:12px;
             font-weight:600;cursor:pointer}
    .birincil{background:#2f80ed;color:#fff}
    .ikincil{background:#2a3a55;color:#cdd9ef}
    .yesil{background:#1d6b3f;color:#dff3e6}
    .tehlike{background:#5a2330;color:#f3c9d0}
    button.d:disabled{opacity:.45;cursor:not-allowed}

    .ilerlemeKutu{margin-top:10px;display:none}
    .cubuk{height:6px;background:#0b1526;border-radius:4px;overflow:hidden}
    .cubuk i{display:block;height:100%;width:0;background:#2f80ed;transition:width .2s}
    .durumSatir{display:flex;align-items:center;gap:8px;margin-top:5px}
    .durum{flex:1;font-size:11.5px;color:#bcd0ee;overflow:hidden;text-overflow:ellipsis;
           white-space:nowrap}
    .durum.hata{color:#f08a8a}
    .ayrintiDugme{background:none;border:0;color:#7fb0f0;font-size:10.5px;cursor:pointer;
                  padding:0;white-space:nowrap;text-decoration:underline}
    .rozet{background:#4a3a12;color:#e0b04f;border-radius:8px;padding:0 5px;font-size:10px;
           margin-left:4px}

    .ozet{margin-top:10px;display:none;background:#0b1526;border-radius:6px;padding:7px 9px}
    .ozet table{width:100%;border-collapse:collapse;font-size:11px}
    .ozet td{padding:3px 2px;border-bottom:1px solid #1c2b47;vertical-align:top}
    .ozet td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .ozet tr:last-child td{border-bottom:0;font-weight:700;color:#cfe0fb;padding-top:6px}
    .ozet .adet{color:#7f93b4}

    .kayit{margin-top:8px;max-height:130px;overflow:auto;background:#0b1526;border-radius:6px;
           padding:6px 8px;font-family:Consolas,monospace;font-size:11px;line-height:1.5}
    .kayit div{white-space:pre-wrap;word-break:break-word}
    .k-bilgi{color:#9fb3d4}.k-uyari{color:#e0b04f}.k-hata{color:#f08a8a}.k-basari{color:#5fd48f}
    .gizli{display:none}
  `;

  const TAKVIM_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>' +
    '<line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

  function el(id) { return golge.getElementById(id); }

  function kucuk(s) {
    try { return String(s).toLocaleLowerCase('tr-TR'); }
    catch (_) { return String(s).toLowerCase(); }
  }
  function kac(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  /* -------------------------------------------------------------- alanlar */
  function secenekleriCoz(a) {
    if (typeof a.secenekler === 'function') {
      try { return a.secenekler() || []; } catch (_) { return []; }
    }
    return a.secenekler || [];
  }

  function alanHtml(a) {
    const genis = a.genis ? ' genis' : '';
    const etiket = a.etiket + (a.aciklama ? ' <i>(' + a.aciklama + ')</i>' : '');
    let ic;

    if (a.tur === 'ay') {
      ic = '<div class="ayKutu">' +
           '<input type="text" class="ayMetin" id="a-' + a.anahtar + '" placeholder="AA.YYYY" ' +
           /* maxlength 10: tam tarih yapıştırılabilsin ki maske ay+yılı doğru
              çıkarabilsin; 7'de tarayıcı önce kırpıyor ve bilgi kayboluyordu */
           'maxlength="10" inputmode="numeric" autocomplete="off">' +
           '<button type="button" class="takvimDugme" id="tk-' + a.anahtar + '" ' +
           'title="Takvimden seç" aria-label="Takvimden seç">' + TAKVIM_SVG + '</button>' +
           '<input type="month" class="gizliAy" id="ay-' + a.anahtar + '" tabindex="-1" aria-hidden="true">' +
           '</div>';
    } else if (a.tur === 'ara') {
      ic = '<div class="ara" id="ara-' + a.anahtar + '">' +
           '<button type="button" class="araAlan" id="araAlan-' + a.anahtar + '">' +
           '<span id="araMetin-' + a.anahtar + '">Tümü</span><i>▾</i></button>' +
           '<div class="araPop gizli" id="araPop-' + a.anahtar + '">' +
           '<input type="text" class="araGiris" id="araGiris-' + a.anahtar + '" ' +
           'placeholder="Ara…" autocomplete="off">' +
           '<div class="araListe" id="araListe-' + a.anahtar + '"></div>' +
           (a.coklu ? '<div class="araAlt">Çoklu seçim için <b>Ctrl</b> basılı tutarak tıklayın</div>' : '') +
           '</div></div>';
    } else if (a.tur === 'secim') {
      const bos = (a.bosSecenek === false) ? '' : '<option value="">Tümü</option>';
      ic = '<select id="a-' + a.anahtar + '">' + bos +
           secenekleriCoz(a).map(function (s) {
             return '<option value="' + kac(s.deger) + '">' + kac(s.ad) + '</option>';
           }).join('') + '</select>';
    } else {
      ic = '<input type="text" id="a-' + a.anahtar + '" placeholder="' + kac(a.ipucu || '') + '" autocomplete="off">';
    }

    const aksiyon = a.aksiyon
      ? '<div class="alanAksiyon"><button type="button" id="aks-' + a.anahtar + '">' +
        kac(a.aksiyon.ad) + '</button></div>'
      : '';

    return '<div class="alan' + genis + '"><label for="a-' + a.anahtar + '">' + etiket + '</label>' +
           ic + aksiyon + '</div>';
  }

  function alanlariCiz() {
    el('izgara').innerHTML = aktifEkran.alanlar.map(alanHtml).join('');
    aktifEkran.alanlar.forEach(function (a) {
      if (a.tur === 'ara') { araBagla(a); }
      else {
        const g = el('a-' + a.anahtar);
        if (g && a.varsayilan) {
          const v = (typeof a.varsayilan === 'function') ? a.varsayilan() : a.varsayilan;
          if (v !== undefined && v !== null) g.value = v;
        }
        if (a.tur === 'ay') ayAlaniniBagla(a);
      }
      if (a.aksiyon) aksiyonBagla(a);
    });
  }

  function aksiyonBagla(a) {
    const d = el('aks-' + a.anahtar);
    if (!d) return;
    d.onclick = async function () {
      if (calisiyor) return;
      const benim = calismaNo;
      mesgul(true);
      Istemci.sifirla();
      el('ilerlemeKutu').style.display = 'block';
      secimSifirlandi = '';
      try {
        const sonuc = await a.aksiyon.calistir(durum, secimAl());
        if (benim !== calismaNo) return;
        if (sonuc) uygulaSecenekler(sonuc);
        durum(secimSifirlandi || 'Tamamlandı.', 100, !!secimSifirlandi);
      } catch (e) {
        if (benim !== calismaNo) return;
        kayitEkle('hata', 'HATA: ' + (e && e.message ? e.message : e));
        durum('Hata oluştu.', 0, true);
      } finally {
        if (benim === calismaNo) mesgul(false);
      }
    };
  }

  /* Maskeli ay-yıl alanı */
  function ayAlaniniBagla(a) {
    const anahtar = a.anahtar;
    const etiket = a.etiket || anahtar;
    const metinG = el('a-' + anahtar);
    const gizliG = el('ay-' + anahtar);
    const dugme = el('tk-' + anahtar);
    if (!metinG) return;

    /* İmleç korunur: değeri her tuşta yeniden kurup imleci sona atmak, mevcut
       bir dönemi düzeltmeyi imkânsız kılıyor ve sessizce bozuk değer bırakıyordu. */
    metinG.addEventListener('input', function () {
      const ham = metinG.value;
      const imleç = metinG.selectionStart;
      const oncekiHane = ham.slice(0, imleç === null ? ham.length : imleç)
        .replace(/\D/g, '').length;

      const m = Yard.ayMaskesi(ham);
      if (m.deger === ham) return;
      metinG.value = m.deger;

      // imleci aynı HANE sırasına geri koy
      let p = 0, sayac = 0;
      while (p < m.deger.length && sayac < oncekiHane) {
        if (m.deger.charCodeAt(p) >= 48 && m.deger.charCodeAt(p) <= 57) sayac++;
        p++;
      }
      try { metinG.setSelectionRange(p, p); } catch (_) {}

      if (m.uyari) Yard.bildir('uyari', '"' + etiket + '" — ' + m.uyari);
    });

    if (dugme && gizliG) {
      dugme.addEventListener('click', function () {
        try {
          const mevcut = Yard.ayaCevir(metinG.value);
          if (mevcut) gizliG.value = mevcut.slice(0, 4) + '-' + mevcut.slice(4);
          if (gizliG.showPicker) gizliG.showPicker(); else gizliG.focus();
        } catch (_) {}
      });
      gizliG.addEventListener('change', function () {
        const m = String(gizliG.value || '').match(/^(\d{4})-(\d{2})$/);
        if (m) metinG.value = m[2] + '.' + m[1];
      });
    }
  }

  /* ------------------------------------------------ aranabilir açılır liste */
  function araBagla(a) {
    const k = a.anahtar;
    ara[k] = {
      alan: a, coklu: !!a.coklu, secili: [], secenekler: secenekleriCoz(a),
      bosAd: a.bosAd || 'Tümü', bosBirakma: !!a.bosBirakma, acilistaki: null
    };

    if (a.varsayilan) {
      const v = (typeof a.varsayilan === 'function') ? a.varsayilan() : a.varsayilan;
      const dizi = Array.isArray(v) ? v : (v ? [v] : []);
      const gecerli = {};
      ara[k].secenekler.forEach(function (s) { gecerli[String(s.deger)] = 1; });
      ara[k].secili = dizi.map(String).filter(function (x) { return gecerli[x]; });
    }

    el('araAlan-' + k).onclick = function (e) {
      e.stopPropagation();
      const pop = el('araPop-' + k);
      const acikti = !pop.classList.contains('gizli');
      araHepsiniKapat();
      if (!acikti) {
        ara[k].acilistaki = imza(ara[k].secili);
        pop.classList.remove('gizli');
        el('araGiris-' + k).value = '';
        araListeCiz(k);
        el('araGiris-' + k).focus();
      }
    };

    el('araGiris-' + k).addEventListener('input', function () { araListeCiz(k); });
    el('araGiris-' + k).addEventListener('keydown', function (e) {
      if (e.key === 'Escape') araKapat(k);
    });

    el('araListe-' + k).onclick = function (e) {
      const satir = e.target.closest ? e.target.closest('.araSatir') : null;
      if (!satir) return;
      const deger = satir.getAttribute('data-deger');
      const d = ara[k];
      if (deger === '') {
        d.secili = [];
        araMetniGuncelle(k); araListeCiz(k); araKapat(k);
        return;
      }
      if (d.coklu && (e.ctrlKey || e.metaKey)) {
        const i = d.secili.indexOf(deger);
        if (i === -1) d.secili.push(deger); else d.secili.splice(i, 1);
        araMetniGuncelle(k); araListeCiz(k);
        return;
      }
      d.secili = [deger];
      araMetniGuncelle(k); araListeCiz(k); araKapat(k);
    };

    araMetniGuncelle(k);
  }

  function araListeCiz(k) {
    const d = ara[k];
    const q = kucuk((el('araGiris-' + k).value || '').trim());
    const uyan = d.secenekler.filter(function (s) {
      return !q || kucuk(s.ad).indexOf(q) !== -1 || kucuk(s.deger).indexOf(q) !== -1;
    });

    let h = '';
    if (!q) {
      h += '<div class="araSatir' + (d.secili.length ? '' : ' secili') + '" data-deger="">' +
           kac(d.bosAd) + '</div>';
    }
    uyan.forEach(function (s) {
      const sec = d.secili.indexOf(String(s.deger)) !== -1;
      h += '<div class="araSatir' + (sec ? ' secili' : '') + '" data-deger="' + kac(s.deger) + '">' +
           kac(s.ad) + '</div>';
    });
    if (!uyan.length) h += '<div class="araBos">eşleşen kayıt yok</div>';
    el('araListe-' + k).innerHTML = h;
  }

  function araMetniGuncelle(k) {
    const d = ara[k];
    let t;
    if (!d.secili.length) t = d.bosAd;
    else if (d.secili.length === 1) {
      const s = d.secenekler.filter(function (x) { return String(x.deger) === d.secili[0]; })[0];
      t = s ? s.ad : d.secili[0];
    } else t = d.secili.length + ' seçili';
    const g = el('araMetin-' + k);
    g.textContent = t;
    g.title = t;
  }

  function imza(dizi) { return dizi.slice().sort().join(','); }

  /*
   * Listeyi kapatır ve seçim değiştiyse alanın "degisince" kancasını çalıştırır.
   * Kanca kapanışta tetiklenir: Ctrl ile çoklu seçim yapılırken her tıklamada
   * sunucuya gitmemek için (GİB'in istek limiti var).
   */
  function araKapat(k) {
    const p = el('araPop-' + k);
    if (!p || p.classList.contains('gizli')) return;
    p.classList.add('gizli');

    const d = ara[k];
    const simdi = imza(d.secili);
    const degisti = d.acilistaki !== null && simdi !== d.acilistaki;
    d.acilistaki = null;
    if (degisti && d.alan && d.alan.degisince) degisinceCalistir(d.alan);
  }

  function araHepsiniKapat() {
    Object.keys(ara).forEach(araKapat);
  }

  /* Kancayı ÇALIŞTIRMADAN kapatır. Sorgu başlarken kullanılır: sorgu seçimleri
     zaten secimAl() ile canlı okur, listeleri tazelemek için GİB'e gitmek gereksiz. */
  function araHepsiniKapatSessiz() {
    Object.keys(ara).forEach(function (k) {
      const p = el('araPop-' + k);
      if (p) p.classList.add('gizli');
      if (ara[k]) ara[k].acilistaki = null;
    });
  }

  async function degisinceCalistir(a) {
    if (calisiyor) return;
    const benim = calismaNo;
    mesgul(true);
    Istemci.sifirla();
    el('ilerlemeKutu').style.display = 'block';
    secimSifirlandi = '';
    try {
      const sonuc = await a.degisince(secimAl(), durum);
      if (benim !== calismaNo) return;
      if (sonuc) uygulaSecenekler(sonuc);
      durum(secimSifirlandi || 'Listeler güncellendi.', 100, !!secimSifirlandi);
    } catch (e) {
      if (benim !== calismaNo) return;
      kayitEkle('uyari', 'Listeler yenilenemedi: ' + (e && e.message ? e.message : e));
      durum(e && e.limit ? e.message : 'Listeler yenilenemedi.', 0, true);
    } finally {
      if (benim === calismaNo) mesgul(false);
    }
  }

  function uygulaSecenekler(sonuc) {
    if (sonuc.yillar && sonuc.yillar.length) {
      araDoldur('yil', sonuc.yillar.map(function (y) { return { deger: y, ad: y }; }));
    }
    if (sonuc.vergiTurleri) araDoldur('vergiTuru', sonuc.vergiTurleri);
    if (sonuc.vergiDaireleri) araDoldur('vdKodu', sonuc.vergiDaireleri);
  }

  function araDoldur(k, secenekler) {
    if (!ara[k] || !secenekler || !secenekler.length) return;
    const oncekiVardi = ara[k].secili.length > 0;
    ara[k].secenekler = secenekler;
    const gecerli = {};
    secenekler.forEach(function (s) { gecerli[String(s.deger)] = 1; });
    ara[k].secili = ara[k].secili.filter(function (v) { return gecerli[v]; });
    // Seçim listeden düştüyse boşta bırakma (boş = "tümü" anlamına gelir):
    // kullanıcının kastı bu değildi, ilk seçeneğe geri dön.
    if (oncekiVardi && !ara[k].secili.length) {
      if (ara[k].bosBirakma) {
        // Yıl gibi "boş = tümü" anlamına gelen alanlarda boşta bırakma:
        // istemeden çok daha büyük bir sorgu kurulmasın.
        ara[k].secili = [String(secenekler[0].deger)];
        secimSifirlandi = '"' + ara[k].alan.etiket + '" seçiminiz bu listede yok, ' +
          secenekler[0].ad + ' seçildi.';
        Yard.bildir('uyari', secimSifirlandi);
      } else {
        // Süzgeç kendiliğinden kalktı: bu kullanıcının kastı değildi, gizli
        // günlükte bırakılmaz — durum satırında da görünür.
        secimSifirlandi = '"' + ara[k].alan.etiket + '" seçiminiz bu yıl(lar)da yok, ' +
          'Tümü olarak sıfırlandı.';
        Yard.bildir('uyari', secimSifirlandi);
      }
    }
    araMetniGuncelle(k);
    const pop = el('araPop-' + k);
    if (pop && !pop.classList.contains('gizli')) araListeCiz(k);
  }

  function secimAl() {
    const s = {};
    aktifEkran.alanlar.forEach(function (a) {
      if (a.tur === 'ara') {
        const d = ara[a.anahtar];
        s[a.anahtar] = d ? (d.coklu ? d.secili.slice() : (d.secili[0] || '')) : (a.coklu ? [] : '');
      } else {
        const g = el('a-' + a.anahtar);
        s[a.anahtar] = g ? g.value : '';
      }
    });
    return s;
  }

  /* ------------------------------------------------------- durum / ayrıntı */
  let uyariSayisi = 0;

  function kayitEkle(tur, mesaj) {
    if (!golge) return;
    if (tur === 'uyari' || tur === 'hata') uyariSayisi++;
    const k = el('kayit');
    const d = document.createElement('div');
    d.className = 'k-' + tur;
    d.textContent = mesaj;
    k.appendChild(d);
    while (k.childNodes.length > 300) k.removeChild(k.firstChild);
    k.scrollTop = k.scrollHeight;
    if (tur === 'hata') ayrintiAc(true);
    rozetGuncelle();
  }

  function rozetGuncelle() {
    const r = el('rozet');
    if (!r) return;
    if (uyariSayisi) { r.textContent = uyariSayisi; r.classList.remove('gizli'); }
    else r.classList.add('gizli');
  }

  function ayrintiAc(ac) {
    const k = el('kayit');
    const b = el('btnAyrinti');
    if (ac === undefined) ac = k.classList.contains('gizli');
    k.classList.toggle('gizli', !ac);
    b.textContent = ac ? 'Ayrıntıyı gizle' : 'Ayrıntı';
  }

  function durum(metin, yuzde, hataMi) {
    if (!golge) return;
    el('ilerlemeKutu').style.display = 'block';
    const g = el('durum');
    g.textContent = metin || '';
    g.title = metin || '';
    g.classList.toggle('hata', !!hataMi);
    if (typeof yuzde === 'number') el('cubuk').style.width = Math.max(0, Math.min(100, yuzde)) + '%';
  }

  function kimlikGoster() {
    if (!golge) return;
    const m = aktifEkran.mukellefBul ? aktifEkran.mukellefBul() : { ad: '', kimlik: '' };
    el('kimlik').innerHTML = m.ad
      ? kac(m.ad) + (m.kimlik ? ' <span>· ' + kac(m.kimlik) + '</span>' : '')
      : '<span>Mükellef bilgisi okunamadı — giriş yaptığınızdan emin olun.</span>';
  }

  function mesgul(durumu) {
    calisiyor = durumu;
    if (!golge) return;
    el('btnExcel').disabled = durumu;
    el('btnKismi').disabled = durumu;
    el('btnPdf').disabled = durumu;
    const es = el('ekranSec'); if (es) es.disabled = durumu;
    Array.prototype.forEach.call(golge.querySelectorAll('.alanAksiyon button'), function (b) {
      b.disabled = durumu;
    });
    el('btnIptal').classList.toggle('gizli', !durumu);
    if (!durumu) kismiGoster();
  }

  /* ---------------------------------------------------------- özet + kısmi */
  function ozetGoster(kayitlar) {
    const kap = el('ozet');
    /* Gizlemek yetmez, İÇERİK de silinir: gizli kalmış eski rakamlar bir
       sonraki gösterimde önceki mükellefe ait olarak geri gelmesin. */
    const gizle = function () { kap.style.display = 'none'; kap.innerHTML = ''; };
    if (!aktifEkran.ozet || !kayitlar || !kayitlar.length) { gizle(); return; }
    let o;
    try { o = aktifEkran.ozet(kayitlar); } catch (_) { gizle(); return; }
    if (!o || !o.satirlar || !o.satirlar.length) { gizle(); return; }

    const para = function (n) {
      try { return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
      catch (_) { return String(n); }
    };
    let h = '<table>';
    o.satirlar.forEach(function (s) {
      h += '<tr><td>' + kac(s.etiket) + ' <span class="adet">(' + s.adet + ')</span></td><td>' +
           para(s.tutar) + ' ₺</td></tr>';
    });
    h += '<tr><td>TOPLAM (' + o.toplamAdet + ' satır)</td><td>' + para(o.toplamTutar) + ' ₺</td></tr></table>';
    kap.innerHTML = h;
    kap.style.display = 'block';
  }

  /* Son sonuç düğmeleri: yarım kalan çekimi kurtarma + alındı PDF'leri */
  function kismiGoster() {
    if (!golge) return;
    const n = bekleyen.kayitlar.length;
    const kismi = el('btnKismi');
    const pdf = el('btnPdf');

    if (!n || bekleyen.tamam) {
      kismi.classList.add('gizli');
    } else {
      let satir = 0;
      for (let i = 0; i < n; i++) satir += Math.max(1, (bekleyen.kayitlar[i].detaylar || []).length);
      kismi.textContent = 'Toplananları Excel\'e Aktar (' + satir + ' satır)';
      kismi.classList.remove('gizli');
    }

    // PDF düğmesi yalnızca gerçekten indirilebilir alındı varsa görünür.
    if (!n || !aktifEkran.pdfleriTopla || !aktifEkran.pdfSayisi) {
      pdf.classList.add('gizli');
      return;
    }
    const s = aktifEkran.pdfSayisi(bekleyen.kayitlar);
    if (!s.indirilebilir) {
      pdf.classList.add('gizli');
      return;
    }
    pdf.textContent = 'Alındı PDF\'lerini indir (' +
      (s.indirilebilir < s.toplam ? s.indirilebilir + '/' + s.toplam : String(s.indirilebilir)) +
      ' alındı)';
    pdf.classList.remove('gizli');
  }

  /* --------------------------------------------------------- filtre yükleme */
  /*
   * Bu da bir GİB istek akışıdır (yıl taraması ~11 istek) ve bu yüzden meşgul
   * kilidine DAHİLDİR. Kilitsizken paneli kapat/aç yapmak ikinci bir tarama
   * başlatıyor, Durdur düğmesi görünmüyor ve nezaket penceresi başına birden
   * fazla istek gidiyordu — servis istek limitine giden en kısa yol.
   */
  async function filtreleriYukle() {
    if (!aktifEkran.filtreleriYukle || filtrelerYuklendi) return;
    if (filtreYukleniyor) return filtreYukleniyor;   // uçuştaki yükleme yeter
    if (calisiyor) return;                            // başka bir işlem sürüyor

    const benim = calismaNo;
    mesgul(true);

    filtreYukleniyor = (async function () {
      try {
        Istemci.sifirla();
        durum('Filtreler yükleniyor…', 5);
        const f = await aktifEkran.filtreleriYukle(secimAl(), durum);
        if (benim !== calismaNo) return;
        uygulaSecenekler(f);
        filtrelerYuklendi = true;
        el('ilerlemeKutu').style.display = 'none';
        kimlikGoster();
      } catch (e) {
        if (benim !== calismaNo) return;
        el('ilerlemeKutu').style.display = 'none';
        kayitEkle('uyari', 'Filtreler yüklenemedi (sorgu yine de çalışır): ' +
          (e && e.message ? e.message : e));
      } finally {
        // Eskimiş akış yeni durumu ezmesin.
        if (benim === calismaNo) { filtreYukleniyor = null; mesgul(false); }
      }
    })();

    return filtreYukleniyor;
  }

  /* ---------------------------------------------------------------- akışlar */
  async function calistir() {
    if (calisiyor) return;
    const benim = ++calismaNo;
    mesgul(true);
    Istemci.sifirla();
    araHepsiniKapatSessiz();
    el('ilerlemeKutu').style.display = 'block';
    el('cubuk').style.width = '0';
    ozetGoster(null);

    const secim = secimAl();
    const kimlik = aktifEkran.mukellefBul ? aktifEkran.mukellefBul() : { ad: '', kimlik: '' };
    const baglam = { ad: kimlik.ad, kimlik: kimlik.kimlik, secim: secim };

    const toplananlar = [];
    bekleyen = { kayitlar: toplananlar, baglam: baglam, tamam: false };

    try {
      kayitEkle('bilgi', '── Sorgu başladı ──');
      await aktifEkran.topla(secim, durum, toplananlar);
      if (benim !== calismaNo) return;   // panel bu arada sıfırlandı

      if (!toplananlar.length) {
        kayitEkle('uyari', 'Seçilen ölçütlerde kayıt bulunamadı.');
        durum('Kayıt bulunamadı.', 100);
        return;
      }
      ozetGoster(toplananlar);
      aktar(toplananlar, baglam);
      bekleyen.tamam = true;   // kayıtlar PDF indirme için elde kalır
    } catch (e) {
      /* Sıfırlama sonrası ekrana YAZILMAZ: yoksa iptal edilen sorgunun özeti
         (önceki mükellefin rakamları) yeni mükellefin panelinde belirir. */
      if (benim !== calismaNo) return;
      const kismi = toplananlar.length;
      if (e && e.iptal) {
        kayitEkle('uyari', 'Durduruldu.' + (kismi ? ' ' + kismi + ' alındı korundu.' : ''));
        durum('Durduruldu' + (kismi ? ' — toplananlar korundu.' : '.'), 0);
      } else {
        kayitEkle('hata', 'HATA: ' + (e && e.message ? e.message : e));
        durum(e && e.message ? e.message : 'Hata oluştu.', 0, true);
      }
      ozetGoster(toplananlar);
    } finally {
      if (benim === calismaNo) mesgul(false);
    }
  }

  function aktar(kayitlar, baglam) {
    const tablo = aktifEkran.excelUret(kayitlar, baglam);
    const blob = Xlsx.olustur({
      sayfaAdi: tablo.sayfaAdi || 'Veriler',
      sutunlar: tablo.sutunlar,
      satirlar: tablo.satirlar
    });
    const ad = aktifEkran.dosyaAdi(baglam);
    Xlsx.indir(blob, ad);
    kayitEkle('basari', 'Excel indirildi: ' + ad + '  (' + tablo.satirlar.length + ' satır)');
    durum('Tamamlandı — ' + tablo.satirlar.length + ' satır.', 100);
  }

  function kismiAktar() {
    if (!bekleyen.kayitlar.length) return;
    try {
      mesgul(true);
      aktar(bekleyen.kayitlar, bekleyen.baglam || { ad: '', kimlik: '', secim: secimAl() });
      bekleyen.tamam = true;
    } catch (e) {
      kayitEkle('hata', 'HATA: ' + e.message);
    } finally {
      mesgul(false);
    }
  }

  /* Son sorgudaki alındıların PDF'lerini tek bir .zip içinde indirir. */
  async function pdfIndir() {
    if (calisiyor || !bekleyen.kayitlar.length || !aktifEkran.pdfleriTopla) return;
    mesgul(true);
    Istemci.sifirla();
    el('ilerlemeKutu').style.display = 'block';
    el('cubuk').style.width = '0';

    const dosyalar = [];
    try {
      kayitEkle('bilgi', '── Alındı PDF\'leri indiriliyor ──');
      await aktifEkran.pdfleriTopla(bekleyen.kayitlar, durum, dosyalar);
    } catch (e) {
      if (e && e.iptal) kayitEkle('uyari', 'Durduruldu.');
      else kayitEkle('hata', 'HATA: ' + (e && e.message ? e.message : e));
    }

    try {
      if (!dosyalar.length) {
        durum('Hiç PDF alınamadı.', 0, true);
      } else {
        const ad = aktifEkran.pdfZipAdi(bekleyen.baglam || { secim: secimAl() });
        Zip.indir(Zip.olustur(dosyalar), ad);
        kayitEkle('basari', 'İndirildi: ' + ad + '  (' + dosyalar.length + ' PDF)');
        durum('Tamamlandı — ' + dosyalar.length + ' PDF.', 100);
      }
    } catch (e) {
      kayitEkle('hata', 'Paket oluşturulamadı: ' + (e && e.message ? e.message : e));
      durum('Paket oluşturulamadı.', 0, true);
    } finally {
      mesgul(false);
    }
  }

  /* -------------------------------------------------------------------- kur */
  function panelHtml() {
    const ekranSecici = ekranlar.length > 1
      ? '<div class="alan genis" style="margin-bottom:9px"><label for="ekranSec">İşlem</label>' +
        '<select id="ekranSec">' + ekranlar.map(function (e, i) {
          return '<option value="' + i + '">' + kac(e.baslik) + '</option>';
        }).join('') + '</select></div>'
      : '';

    return '<style>' + BICIM + '</style>' +
      '<div class="sarmal">' +
        '<div class="kutu gizli" id="kutu">' +
          '<div class="bas" id="bas"><span class="nokta"></span>' + BASLIK +
            '<button class="kapat" id="kucult" title="Kapat">−</button></div>' +
          '<div class="gov">' +
            '<div class="kimlik" id="kimlik"></div>' +
            ekranSecici +
            '<div class="izgara" id="izgara"></div>' +
            '<div class="ayrac"></div>' +
            '<div class="dugmeler">' +
              '<button class="d birincil" id="btnExcel">Sorgula ve Excel\'e Aktar</button>' +
              '<button class="d yesil gizli" id="btnKismi"></button>' +
              '<button class="d ikincil gizli" id="btnPdf"></button>' +
              '<button class="d tehlike gizli" id="btnIptal">Durdur</button>' +
            '</div>' +
            '<div class="ozet" id="ozet"></div>' +
            '<div class="ilerlemeKutu" id="ilerlemeKutu">' +
              '<div class="cubuk"><i id="cubuk"></i></div>' +
              '<div class="durumSatir">' +
                '<span class="durum" id="durum"></span>' +
                '<button class="ayrintiDugme" id="btnAyrinti">Ayrıntı<span class="rozet gizli" id="rozet"></span></button>' +
              '</div>' +
              '<div class="kayit gizli" id="kayit"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="pill" id="pill"><span class="nokta"></span>' + BASLIK + '</button>' +
      '</div>';
  }

  /* Panel ekranın önemli bir yerini kapatırsa başlığından tutup taşınabilsin */
  /* Sürükleme durumu modül düzeyinde tutulur; belge dinleyicileri tek kez bağlanır. */
  const surukle = { aktif: false, bx: 0, by: 0, ox: 0, oy: 0, kok: null };

  function surukleBagla(kok) {
    surukle.kok = kok;
    el('bas').addEventListener('mousedown', function (e) {
      if (e.target.id === 'kucult') return;
      const r = kok.getBoundingClientRect();
      surukle.aktif = true;
      surukle.bx = e.clientX; surukle.by = e.clientY;
      surukle.ox = r.left; surukle.oy = r.top;
      kok.style.right = 'auto'; kok.style.bottom = 'auto';
      kok.style.left = r.left + 'px'; kok.style.top = r.top + 'px';
      e.preventDefault();
    });
  }

  function genelDinleyiciler() {
    if (genelBaglandi) return;
    genelBaglandi = true;

    document.addEventListener('mousemove', function (e) {
      if (!surukle.aktif || !surukle.kok) return;
      surukle.kok.style.left = Math.max(0, surukle.ox + e.clientX - surukle.bx) + 'px';
      surukle.kok.style.top = Math.max(0, surukle.oy + e.clientY - surukle.by) + 'px';
    });
    document.addEventListener('mouseup', function () { surukle.aktif = false; });
    // Gölge DOM'daki tıklamalar belge düzeyinde ana öğeye yeniden hedeflenir;
    // dışarıya tıklandığında açık listeler kapanır.
    document.addEventListener('click', function (e) {
      if (e.target !== surukle.kok) araHepsiniKapat();
    });
    Yard.abone(function (tur, mesaj) { kayitEkle(tur, mesaj); });
  }

  function ac() {
    el('kutu').classList.remove('gizli');
    el('pill').classList.add('gizli');
    if (!el('izgara').children.length) alanlariCiz();
    kimlikGoster();
    ozetGoster(bekleyen.kayitlar);   // boş sonuçta gizler; eski özet açılışta kalmasın
    kismiGoster();
    filtreleriYukle();
  }

  function kapat() {
    araHepsiniKapat();
    el('kutu').classList.add('gizli');
    el('pill').classList.remove('gizli');
  }

  /*
   * Mükellef değişince / oturum kapanınca panel tamamen sıfırlanır:
   * eski mükellefin sonuçları, süzgeçleri ve yıl listesi kalmasın.
   */
  function sifirla(sebep) {
    if (!golge) return;
    Istemci.iptalEt();
    /* Jetonu ilerlet: uçuştaki sorgu/filtre yüklemesi bittiğinde ekrana
       dokunmasın. Meşgul durumu burada elle çözülür, çünkü o akışların
       finally'si artık bilerek atlanıyor. */
    calismaNo++;
    filtreYukleniyor = null;
    secimSifirlandi = '';
    bekleyen = { kayitlar: [], baglam: null, tamam: false };
    filtrelerYuklendi = false;
    uyariSayisi = 0;
    mesgul(false);
    Object.keys(ara).forEach(function (k) { delete ara[k]; });
    el('izgara').innerHTML = '';
    el('kayit').innerHTML = '';
    el('kayit').classList.add('gizli');
    el('btnAyrinti').textContent = 'Ayrıntı';
    ozetGoster(null);
    el('ilerlemeKutu').style.display = 'none';
    el('cubuk').style.width = '0';
    el('durum').textContent = '';
    rozetGuncelle();
    kismiGoster();
    kapat();
    if (sebep) kayitEkle('bilgi', sebep);
  }

  function kur(liste) {
    ekranlar = liste;
    aktifEkran = liste[0];
    if (document.getElementById(KOK_ID)) return;

    /* Panel YENİDEN kuruluyor olabilir (SPA gövdeyi silmiş olabilir). Modül
       düzeyindeki durum eski panele aitti; koşulsuz sıfırlanır, yoksa önceki
       mükellefin kayıtları ve "Toplananları Aktar" düğmesi yeni panelde kalır. */
    calismaNo++;
    calisiyor = false;
    filtreYukleniyor = null;
    filtrelerYuklendi = false;
    secimSifirlandi = '';
    uyariSayisi = 0;
    bekleyen = { kayitlar: [], baglam: null, tamam: false };
    Object.keys(ara).forEach(function (k) { delete ara[k]; });

    const kok = document.createElement('div');
    kok.id = KOK_ID;
    kok.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    golge = kok.attachShadow({ mode: 'open' });
    golge.innerHTML = panelHtml();
    (document.body || document.documentElement).appendChild(kok);

    el('pill').onclick = ac;
    el('kucult').onclick = kapat;
    el('btnExcel').onclick = calistir;
    el('btnKismi').onclick = kismiAktar;
    el('btnPdf').onclick = pdfIndir;
    el('btnIptal').onclick = function () { Istemci.iptalEt(); durum('Durduruluyor…'); };
    el('btnAyrinti').onclick = function () { ayrintiAc(); };

    const sec = el('ekranSec');
    if (sec) {
      sec.onchange = function () {
        aktifEkran = ekranlar[Number(sec.value)] || ekranlar[0];
        calismaNo++;                 // önceki ekranın uçuştaki akışı ekrana yazmasın
        filtreYukleniyor = null;
        bekleyen = { kayitlar: [], baglam: null, tamam: false };
        filtrelerYuklendi = false;
        Object.keys(ara).forEach(function (k) { delete ara[k]; });
        alanlariCiz();
        ozetGoster(null);
        kismiGoster();
        filtreleriYukle();
      };
    }

    // Açılır listeler panel dışına tıklanınca kapansın.
    // composedPath kullanılıyor: seçim sonrası liste yeniden çizildiği için
    // e.target DOM'dan kopabiliyor ve contains() yanlış sonuç veriyor.
    golge.addEventListener('click', function (e) {
      const yol = e.composedPath ? e.composedPath() : [];
      Object.keys(ara).forEach(function (k) {
        const kap = el('ara-' + k);
        if (!kap) return;
        if (yol.indexOf(kap) !== -1 || kap.contains(e.target)) return;
        // araKapat kullanılır (sınıf eklemek yerine): seçim değiştiyse
        // "degisince" kancası çalışsın, aksi hâlde vergi türü/dairesi
        // listeleri eski yıla ait kalıyor.
        araKapat(k);
      });
    });
    surukleBagla(kok);
    genelDinleyiciler();
  }

  function varMi() { return !!document.getElementById(KOK_ID); }

  return { kur: kur, varMi: varMi, sifirla: sifirla };
})();

/* ==================== 70-ekran-odeme-alindilarim.js ==================== */
/*
 * Ekran modülü: "Ödeme Alındılarım ve Tahsilat Bilgilerim"
 *
 * Liste ekranı (alindi-sorgula) alındıları yüzeysel gösterir; vergi kırılımı
 * (hangi vergi türü, hangi dönem, hangi plaka) detay ekranındadır (odeme-sorgula).
 * Bu modül ikisini birleştirip tek tabloya döker.
 *
 * Sütun adları ve sırası, GİB'in kendi "Excel'e Aktar" çıktılarıyla aynıdır.
 *
 * Yıl listesi: sitenin kendi açılır listesi bir MUI Autocomplete olduğu için
 * DOM'dan güvenilir biçimde okunamıyor. Bunun yerine yıllar API'ye sorularak
 * tespit edilir (her yıl için 1 kayıtlık sorgu) ve yalnızca KAYDI OLAN yıllar
 * listelenir. Sonuç mükellef bazında önbelleğe alınır.
 * GİB desteklemediği yıllara HTTP 400 döndüğü için tarama kendiliğinden durur.
 */

const Ekran = (function () {

  const YIL_ONBELLEK = 'gibTahsilatExcel.yillar.v3.';
  const GERIYE_YIL = 10;   // GİB penceresi ~10 yıl
  /* Önbellek bu süreden eskiyse yeniden taranır. Yıl listesi yıl içinde de
     değişebilir (mükellef o yıl ilk ödemesini yapar), sonsuza kadar güvenilmez. */
  const ONBELLEK_OMRU_MS = 12 * 60 * 60 * 1000;
  /* Tarayıcıda sınırsız mükellef önbelleği birikmesin. */
  const EN_FAZLA_ONBELLEK = 25;

  /* GİB yeni alan eklerse Excel'e ham adıyla ek sütun düşsün diye bilinenler listesi */
  const ALINDI_BILINEN = ['alindiNo', 'secureId', 'islemTarihi', 'toplamOdenen',
    'odemeSekli', 'odemeKaynagi', 'thsSekli', 'odemeYeri', 'indir'];
  const DETAY_BILINEN = ['alindiNo', 'secureId', 'vergiTuru', 'vergiDonem', 'odenen',
    'odemeTarihi', 'plakaNo', 'odemeBelgeNo', 'vergiDairesi', 'orgOid', 'ozellik', 'thsIslemTuru'];

  /* --------------------------------------------------------------- mükellef */

  /* Uygulama kimlik bilgisini sessionStorage.userInfo içinde tutuyor:
     şirketlerde anaKullaniciUnvan, gerçek kişilerde name + surname. */
  function depodanMukellef() {
    try {
      const u = JSON.parse(sessionStorage.getItem('userInfo') || 'null');
      if (!u) return null;
      const unvan = Yard.metin(u.anaKullaniciUnvan).trim();
      const adSoyad = (Yard.metin(u.name).trim() + ' ' + Yard.metin(u.surname).trim()).trim();
      const ad = unvan || adSoyad;
      if (!ad) return null;
      return { ad: ad, kimlik: Yard.metin(u.vkn) || Yard.metin(u.tckn) || '' };
    } catch (_) {
      return null;
    }
  }

  /* Yedek yol: sayfadaki kullanıcı rozetinden oku */
  function domdanMukellef() {
    try {
      const hepsi = document.querySelectorAll('span,div,p,b,strong,a,li,td');
      for (let i = 0; i < hepsi.length; i++) {
        const e = hepsi[i];
        if (e.children.length) continue;
        const t = (e.textContent || '').trim();
        if (!/^\d{10,11}$/.test(t)) continue;

        let p = e.parentElement;
        for (let d = 0; d < 3 && p; d++, p = p.parentElement) {
          const satirlar = String(p.innerText || '').split('\n')
            .map(function (s) { return s.trim(); }).filter(Boolean);
          for (let j = 0; j < satirlar.length; j++) {
            const s = satirlar[j];
            if (s === t || s.length < 3 || s.length > 60) continue;
            if (/\d{6,}/.test(s) || !/[A-ZÇĞİÖŞÜ]/.test(s)) continue;
            return { ad: s, kimlik: t };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  /* Bilerek önbelleğe alınmaz: mükellef değiştiğinde eski adın görünmemesi için
     her seferinde canlı oturumdan okunur. */
  function mukellefBul() {
    return depodanMukellef() || domdanMukellef() || { ad: '', kimlik: '' };
  }

  /* ------------------------------------------------------------------ yıllar */

  function tumYilAraligi() {
    const su = new Date().getFullYear();
    const l = [];
    for (let y = su; y >= su - GERIYE_YIL; y--) l.push(String(y));
    return l;
  }

  /*
   * Önbellek anahtarında HAM VKN/TCKN tutulmaz: amaç yalnızca mükellefleri
   * birbirinden ayırmak; müşterilerin kimlik numaraları tarayıcıda aylarca
   * listelenebilir hâlde birikmesin. Kısa, geri döndürülemez bir özet yeter.
   */
  function kimlikOzeti(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = ((h1 ^ s.charCodeAt(i)) >>> 0) * 0x01000193 >>> 0;
      h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }

  function yilAnahtari() {
    const k = mukellefBul().kimlik;
    return YIL_ONBELLEK + (k ? kimlikOzeti(k) : 'genel');
  }

  /* Ham kimlik içeren eski sürüm anahtarları temizlenir (bir kez, açılışta). */
  function eskiAnahtarlariTemizle() {
    try {
      const sil = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^gibTahsilatExcel\.yillar\.v[12]\./.test(k)) sil.push(k);
      }
      sil.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
  }

  /* En eski kayıtları atarak önbelleği sınırlar. */
  function onbellegiBuda() {
    try {
      const girisler = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(YIL_ONBELLEK) !== 0) continue;
        let z = 0;
        try { z = Number((JSON.parse(localStorage.getItem(k)) || {}).zaman) || 0; } catch (_) {}
        girisler.push({ k: k, z: z });
      }
      if (girisler.length <= EN_FAZLA_ONBELLEK) return;
      girisler.sort(function (a, b) { return a.z - b.z; });
      for (let i = 0; i < girisler.length - EN_FAZLA_ONBELLEK; i++) {
        localStorage.removeItem(girisler[i].k);
      }
    } catch (_) {}
  }

  eskiAnahtarlariTemizle();

  /*
   * Oturum belleği: taraması yarım kalan (güvenilmez) yıl listesi kalıcı
   * önbelleğe YAZILMAZ ama o oturumda kullanılabilsin diye burada tutulur.
   * Mükellef değişince kendiliğinden geçersizleşsin diye kimlikle birlikte saklanır.
   */
  let oturumYillari = { kimlik: null, yillar: null };

  function oturumaYaz(yillar) {
    oturumYillari = { kimlik: mukellefBul().kimlik || 'genel', yillar: yillar.slice() };
  }

  function onbellekOku() {
    try {
      const c = JSON.parse(localStorage.getItem(yilAnahtari()) || 'null');
      if (c && Array.isArray(c.yillar) && c.yillar.length) return c;
    } catch (_) {}
    return null;
  }

  function onbellekYaz(yillar) {
    oturumaYaz(yillar);
    try {
      localStorage.setItem(yilAnahtari(),
        JSON.stringify({ yillar: yillar, zaman: Date.now(), tam: true }));
      onbellegiBuda();
    } catch (_) {}
  }

  function onbellekSil() {
    try { localStorage.removeItem(yilAnahtari()); } catch (_) {}
    oturumYillari = { kimlik: null, yillar: null };
  }

  /*
   * Önbellek hâlâ güvenilir mi? Yalnızca TAM biten bir tarama ve makul yaş
   * kabul edilir. Aksi hâlde koca bir yıl (örn. yılbaşından sonra cari yıl)
   * listede hiç görünmeden Excel'in dışında kalır — sessiz ve en tehlikeli hata.
   */
  function onbellekTaze(c) {
    if (!c || c.tam !== true) return false;
    const z = Number(c.zaman) || 0;
    return z > 0 && (Date.now() - z) < ONBELLEK_OMRU_MS;
  }

  function onbellektenYillar() {
    const kimlik = mukellefBul().kimlik || 'genel';
    if (oturumYillari.kimlik === kimlik && oturumYillari.yillar && oturumYillari.yillar.length) {
      return oturumYillari.yillar.slice();
    }
    const c = onbellekOku();
    return c ? c.yillar.slice() : null;
  }

  /* Panel açılır açılmaz dolu olsun diye: önbellek varsa o, yoksa tam aralık. */
  function yilSecenekleri() {
    return (onbellektenYillar() || tumYilAraligi()).map(function (y) {
      return { deger: y, ad: y };
    });
  }

  /* Seçim boşsa "tüm yıllar" demektir. */
  function yilListesi(secim) {
    const s = secim && secim.yil;
    return Array.isArray(s) ? s.filter(Boolean).map(String)
                            : (s ? [String(s)] : []);
  }

  function secilenYillar(secim) {
    const liste = yilListesi(secim);
    if (liste.length) return liste.slice().sort().reverse();
    const c = onbellektenYillar();
    return (c && c.length) ? c.slice() : tumYilAraligi();
  }

  function yilEtiketi(secim) {
    const liste = yilListesi(secim);
    if (!liste.length) return 'TUM YILLAR';
    if (liste.length === 1) return liste[0];
    const s = liste.slice().sort();
    return s[0] + '-' + s[s.length - 1];
  }

  function plakaSadelestir(v) {
    return Yard.metin(v).replace(/[\s\-.]/g, '').toUpperCase();
  }

  /*
   * Detay satırındaki vergi dönemini karşılaştırılabilir aralığa çevirir.
   *   "2026/04-2026/04" -> { bas:"202604", bit:"202604" }
   *   "2026/01"         -> { bas:"202601", bit:"202601" }
   * Anlaşılamazsa null döner; çağıran satırı ELEMEZ (bilinmeyen veri sessizce
   * atılmamalı), yalnızca sayar ve kullanıcıyı uyarır.
   */
  function donemAralik(v) {
    const s = Yard.metin(v).trim();
    if (!s) return null;

    const coz = function (p) {
      const m = String(p).trim().match(/^(\d{4})\s*[\/.\-]\s*(\d{1,2})$/);
      if (m) return m[1] + String(parseInt(m[2], 10)).padStart(2, '0');
      const m2 = String(p).trim().match(/^(\d{4})(\d{2})$/);
      return m2 ? (m2[1] + m2[2]) : null;
    };

    // "2026/04-2026/04" -> son tireden böl (yıl/ay içinde de tire olabilir)
    let bas = null, bit = null;
    const i = s.lastIndexOf('-');
    if (i > 0) {
      bas = coz(s.slice(0, i));
      bit = coz(s.slice(i + 1));
    }
    if (!bas || !bit) { bas = bit = coz(s); }
    if (!bas || !bit) return null;
    return (bas <= bit) ? { bas: bas, bit: bit } : { bas: bit, bit: bas };
  }

  /*
   * Yılları tarar. Dönüş: { yillar, tam }
   *
   * `tam` YALNIZCA tarama düzgün bittiğinde true olur. Yarım kalan bir tarama
   * "tam" sayılıp kalıcı önbelleğe yazılırsa, eksik yıllar bir daha hiç
   * sorgulanmaz ve o yılların tahsilatları kalıcı olarak görünmez olur.
   *
   * GİB desteklemediği yıllara HTTP 400 döner; iki ardışık 400 taramanın
   * NORMAL sonudur (tam sayılır). Başka bir hata ise liste eksik demektir.
   */
  async function yillariTara(ilerleme) {
    await Kanca.hazirBekle(20000);
    const su = new Date().getFullYear();
    const enEski = su - GERIYE_YIL;
    const toplamAdim = su - enEski + 1;
    const bulunan = [];
    let ardArda = 0, ardArda400 = 0, tam = true;

    for (let y = su; y >= enEski; y--) {
      Istemci.iptalKontrol();
      if (ilerleme) {
        ilerleme('Kaydı olan yıllar taranıyor… ' + y,
                 Math.round((su - y + 1) / toplamAdim * 100));
      }
      try {
        const v = await Istemci.istek('alindi-sorgula', listeGovdesi(y, null, '', '')(1, 1), 1);
        const toplam = Number(((v || {}).pageDetail || {}).total) || 0;
        ardArda = 0; ardArda400 = 0;
        if (toplam > 0) bulunan.push(String(y));
      } catch (e) {
        if (e && e.iptal) throw e;
        if (e && e.limit) {
          Yard.bildir('uyari', 'İstek limiti nedeniyle yıl taraması yarıda kesildi. ' +
            'Liste EKSİK olabilir; birkaç dakika sonra "↻ Yılları yenile" ile tamamlayın.');
          tam = false;
          break;
        }
        ardArda++;
        if (e && e.durum === 400) ardArda400++;
        if (ardArda >= 2) {
          if (ardArda400 < ardArda) {
            tam = false;
            Yard.bildir('uyari', 'Yıl taraması hata nedeniyle yarıda kesildi (' +
              (e && e.message ? e.message : e) + '). Liste EKSİK olabilir.');
          }
          break;
        }
      }
    }
    return { yillar: bulunan, tam: tam };
  }

  /*
   * Cari yıl listede yoksa TEK istekle denetlenir. Yılbaşından sonra ya da
   * mükellef o yıl ilk ödemesini yaptığında koca bir yılın sessizce kaybolmasını
   * engelleyen ucuz emniyet: tam tarama yerine 1 istek.
   */
  async function cariYiliDogrula(yillar) {
    const su = String(new Date().getFullYear());
    if (yillar.indexOf(su) !== -1) return yillar;
    try {
      const v = await Istemci.istek('alindi-sorgula', listeGovdesi(su, null, '', '')(1, 1), 1);
      if ((Number(((v || {}).pageDetail || {}).total) || 0) > 0) {
        Yard.bildir('bilgi', su + ' yılında kayıt bulundu, yıl listesine eklendi.');
        return [su].concat(yillar);
      }
    } catch (e) {
      if (e && e.iptal) throw e;
      Yard.bildir('uyari', su + ' yılı denetlenemedi: ' + (e && e.message ? e.message : e));
    }
    return yillar;
  }

  async function yillariYenile(ilerleme) {
    const t = await yillariTara(ilerleme);
    const yillar = t.yillar;

    if (yillar.length && t.tam) {
      onbellekYaz(yillar);
      Yard.bildir('basari', 'Kaydı olan yıllar: ' + yillar.join(', '));
    } else if (yillar.length) {
      // Eksik liste kalıcılaşmasın: yalnızca bu oturumda kullanılır.
      oturumaYaz(yillar);
      Yard.bildir('uyari', 'Bulunanlar: ' + yillar.join(', ') +
        ' — tarama tamamlanamadığı için kalıcı olarak kaydedilmedi.');
    } else if (t.tam) {
      onbellekSil();
      Yard.bildir('bilgi', 'Hiçbir yılda kayıt bulunamadı.');
    } else {
      // Boş sonuç önbelleği SİLMEZ: limit/hata yüzünden boş dönmüş olabilir.
      Yard.bildir('uyari', 'Tarama tamamlanamadığı için sonuç güvenilir değil; ' +
        'önceki yıl listesi korundu.');
    }

    return { yillar: yillar.length ? yillar : (onbellektenYillar() || tumYilAraligi()) };
  }

  /* ---------------------------------------------------------------- sütunlar */

  const SUTUNLAR = [
    { ad: 'Ödeme Yılı',          tip: 'metin', genislik: 10, al: function (c) { return c.yil; } },
    { ad: 'Ödeme Kaynağı',       tip: 'metin', genislik: 16, al: function (c) { return c.a.odemeKaynagi; } },
    { ad: 'Alındı No',           tip: 'metin', genislik: 22, al: function (c) { return c.a.alindiNo; } },
    { ad: 'Ödeme Yeri',          tip: 'metin', genislik: 28, al: function (c) { return c.a.odemeYeri; } },
    { ad: 'İşlem Tarihi',        tip: 'tarih', genislik: 12, al: function (c) { return c.a.islemTarihi; } },
    { ad: 'Tahsilat Şekli',      tip: 'metin', genislik: 15, al: function (c) { return c.a.thsSekli; } },
    { ad: 'Ödeme Şekli',         tip: 'metin', genislik: 15, al: function (c) { return c.a.odemeSekli; } },
    /* ---- detay (Tahsilat Bilgileri) ----
       Alındı toplamı (toplamOdenen) bilerek yazılmaz: satırlar açıldığı için her
       satırda tekrar eder ve yanlışlıkla toplanabilir. Tek tutar sütunu "Tutar". */
    { ad: 'Vergi Dairesi',       tip: 'metin', genislik: 30, al: function (c) { return c.d.vergiDairesi; } },
    { ad: 'Belge No',            tip: 'metin', genislik: 24, al: function (c) { return c.d.odemeBelgeNo; } },
    { ad: 'Vergi Türü',          tip: 'metin', genislik: 40, al: function (c) { return c.d.vergiTuru; } },
    { ad: 'Vergi Dönemi',        tip: 'metin', genislik: 18, al: function (c) { return c.d.vergiDonem; } },
    { ad: 'Plaka',               tip: 'metin', genislik: 13, al: function (c) { return c.d.plakaNo; } },
    { ad: 'Ödeme Tarihi',        tip: 'tarih', genislik: 12, al: function (c) { return c.d.odemeTarihi; } },
    { ad: 'Tutar',               tip: 'sayi',  genislik: 14, al: function (c) { return c.d.odenen; } },
    { ad: 'Özellik',             tip: 'metin', genislik: 38, al: function (c) { return c.d.ozellik; } },
    { ad: 'Tahsilat İşlem Türü', tip: 'metin', genislik: 22, al: function (c) { return c.d.thsIslemTuru; } }
  ];

  const ALANLAR = [
    /* bosBirakma: seçili yıl yeni listede yoksa seçim BOŞA düşmesin — boş,
       "tüm yıllar" demektir ve kullanıcı istemeden onlarca dakikalık bir
       tarama başlatmış olur. Bunun yerine listenin ilk (en yeni) yılına döner. */
    { anahtar: 'yil', etiket: 'Ödeme Yılı', aciklama: 'çoklu seçim için Ctrl',
      tur: 'ara', coklu: true, genis: true, bosAd: '*** TÜM YILLAR ***',
      bosBirakma: true,
      secenekler: yilSecenekleri,
      varsayilan: function () {
        const l = onbellektenYillar();
        return (l && l.length) ? [l[0]] : [String(new Date().getFullYear())];
      },
      aksiyon: { ad: '↻ Yılları yenile', calistir: yillariYenile },
      degisince: turleriYukle },
    { anahtar: 'donemBas',  etiket: 'Vergi dönemi başlangıç', tur: 'ay' },
    { anahtar: 'donemBit',  etiket: 'Vergi dönemi bitiş',     tur: 'ay' },
    { anahtar: 'vergiTuru', etiket: 'Vergi türü', tur: 'ara', coklu: true, genis: true,
      bosAd: 'Tümü' },
    { anahtar: 'vdKodu',    etiket: 'Vergi dairesi', tur: 'ara', genis: true, bosAd: 'Tümü' },
    { anahtar: 'plaka',     etiket: 'Plaka içerir', aciklama: 'boş = hepsi',
      tur: 'metin', genis: true, ipucu: 'örn. 06 AB 1234' }
  ];

  /* ------------------------------------------------------- istek gövdeleri */

  function listeGovdesi(yil, secim, donemBas, donemBit) {
    return function (sayfa, boyut) {
      return {
        meta: {
          pagination: { pageNo: sayfa, pageSize: boyut },
          sortFieldName: 'islemTarihi', sortType: 'DESC', filters: []
        },
        data: {
          yil: String(yil),
          vdKodu: (secim && secim.vdKodu) || '',
          vergiDonemBaslangic: donemBas || '',
          vergiDonemBitis: donemBit || '',
          vergiTuru: (secim && secim.vergiTuru) || ''
        }
      };
    };
  }

  function detayGovdesi(alindi, yil) {
    return function (sayfa, boyut) {
      return {
        meta: {
          pagination: { pageNo: sayfa, pageSize: boyut },
          sortFieldName: 'id', sortType: 'ASC', filters: []
        },
        data: { alindiNo: alindi.alindiNo, secureId: alindi.secureId, yil: String(yil) }
      };
    };
  }

  /* -------------------------------------------------- vergi türü / dairesi
   * Bu listeler YILA GÖRE değişir: 2019'da olmayan bir vergi türü 2026'da
   * olabilir. Bu yüzden seçilen yıl(lar)ın listeleri alınıp birleştirilir.
   * Aynı yıl ikinci kez sorulmasın diye sonuç bellekte tutulur (istek limiti).
   */
  const turOnbellek = {};

  async function listeleriAl(yil) {
    const anahtar = (mukellefBul().kimlik || '') + '|' + yil;
    if (turOnbellek[anahtar]) return turOnbellek[anahtar];

    const v = await Istemci.istek('alindi-sorgula', listeGovdesi(yil, null, '', '')(1, 1));
    const sonuc = {
      vergiTurleri: ((v && v.vergiTurleriList) || []).map(function (x) {
        return { deger: x.vergiKodu, ad: x.vergiUzunAdi };
      }),
      vergiDaireleri: ((v && v.vergiDairesiList) || []).map(function (x) {
        return { deger: x.orgOid, ad: x.vdAdi };
      })
    };
    turOnbellek[anahtar] = sonuc;
    return sonuc;
  }

  async function turleriYukle(secim, ilerleme) {
    await Kanca.hazirBekle(20000);
    const yillar = secilenYillar(secim);
    const turler = {}, daireler = {};

    for (let i = 0; i < yillar.length; i++) {
      Istemci.iptalKontrol();
      if (ilerleme && yillar.length > 1) {
        ilerleme('Vergi türleri alınıyor… ' + yillar[i],
                 Math.round((i + 1) / yillar.length * 100));
      }
      const s = await listeleriAl(yillar[i]);
      s.vergiTurleri.forEach(function (x) { turler[x.deger] = x.ad; });
      s.vergiDaireleri.forEach(function (x) { daireler[x.deger] = x.ad; });
    }

    return {
      vergiTurleri: Object.keys(turler).sort().map(function (k) {
        return { deger: k, ad: turler[k] };
      }),
      vergiDaireleri: Object.keys(daireler).sort().map(function (k) {
        return { deger: k, ad: daireler[k] };
      })
    };
  }

  async function filtreleriYukle(secim, ilerleme) {
    await Kanca.hazirBekle(20000);

    const onbellek = onbellekOku();
    let yillar;

    if (onbellekTaze(onbellek)) {
      // Taze önbellek: tam tarama yerine yalnızca cari yıl denetlenir.
      yillar = await cariYiliDogrula(onbellek.yillar.slice());
      if (yillar.length !== onbellek.yillar.length) onbellekYaz(yillar);
      else oturumaYaz(yillar);
    } else {
      const t = await yillariTara(ilerleme);
      yillar = t.yillar;
      if (yillar.length && t.tam) {
        onbellekYaz(yillar);
      } else if (yillar.length) {
        oturumaYaz(yillar);
      } else if (onbellek && onbellek.yillar.length && !t.tam) {
        // Tarama boş döndü ama tamamlanmadı: eski listeyi silmek yerine koru.
        yillar = onbellek.yillar.slice();
        Yard.bildir('uyari', 'Yıl taraması tamamlanamadı; önceki liste kullanılıyor.');
      }
      if (yillar.length) Yard.bildir('bilgi', 'Kaydı olan yıllar: ' + yillar.join(', '));
    }

    // Yıl listesi yeni geldiyse varsayılan seçim (en yeni yıl) ona göre olsun
    const etkinSecim = (yillar && yillar.length && !yilListesi(secim).length)
      ? { yil: [yillar[0]] } : secim;

    const sonuc = await turleriYukle(etkinSecim, ilerleme);
    if (yillar && yillar.length) sonuc.yillar = yillar;
    return sonuc;
  }

  /*
   * topla(secim, ilerleme, toplananlar)
   * Bulunan kayıtlar doğrudan `toplananlar` dizisine eklenir; böylece işlem
   * yarıda kesilse (Durdur) veya hata alsa bile o ana kadarki veri panelde kalır.
   *
   * SÜZGEÇLERİN TAMAMI SATIR BAZINDA UYGULANIR. Sunucunun süzgeci ALINDI
   * düzeyindedir: bir alındıda ölçüte uyan tek bir satır varsa alındının
   * TAMAMINI döndürür ve detay isteğinde süzgeç parametresi yoktur. Yani
   * yalnızca sunucuya güvenirsek dönem/daire/tür dışı satırlar Excel'e girer
   * ve tutar toplamı sessizce şişer. Bu yüzden burada tekrar süzülür.
   */
  async function topla(secim, ilerleme, toplananlar) {
    await Kanca.hazirBekle(20000);

    const yillar = secilenYillar(secim);
    const donemBas = Yard.ayaCevir(secim.donemBas);
    const donemBit = Yard.ayaCevir(secim.donemBit);
    if (donemBas === null) {
      throw new Error('Vergi dönemi başlangıcı anlaşılamadı. AA.YYYY yazın (örn. 06.2026).');
    }
    if (donemBit === null) {
      throw new Error('Vergi dönemi bitişi anlaşılamadı. AA.YYYY yazın (örn. 12.2026).');
    }
    if (donemBas && donemBit && donemBas > donemBit) {
      throw new Error('Vergi dönemi başlangıcı bitişten sonra olamaz (' +
        Yard.aydanMetne(donemBas) + ' > ' + Yard.aydanMetne(donemBit) + ').');
    }

    const turler = (Array.isArray(secim.vergiTuru) ? secim.vergiTuru
      : (secim.vergiTuru ? [secim.vergiTuru] : [])).filter(Boolean);
    const plaka = plakaSadelestir(secim.plaka);
    const vdKodu = Yard.metin(secim.vdKodu).trim();
    const donemSuz = !!(donemBas || donemBit);
    const suzgecVar = turler.length > 0 || !!plaka || !!vdKodu || donemSuz;
    // Tek tür seçiliyse sunucuya da bildir: gereksiz alındı çekilmesin.
    const sunucuSecim = { vdKodu: vdKodu, vergiTuru: turler.length === 1 ? turler[0] : '' };

    let hataSayisi = 0;
    let elenen = 0;
    let cozulemeyen = 0;

    for (let yi = 0; yi < yillar.length; yi++) {
      const yil = yillar[yi];
      Istemci.iptalKontrol();
      ilerleme(yil + ' — alındı listesi alınıyor…', Math.round(yi / yillar.length * 100));

      const alindilar = await Istemci.tumSayfalar(
        'alindi-sorgula', listeGovdesi(yil, sunucuSecim, donemBas, donemBit), { sayfaBoyutu: 100 });

      Yard.bildir('bilgi', yil + ': ' + alindilar.length + ' alındı bulundu.');

      for (let i = 0; i < alindilar.length; i++) {
        Istemci.iptalKontrol();
        const a = alindilar[i];
        const yerel = alindilar.length ? (i + 1) / alindilar.length : 1;
        ilerleme(yil + ' — alındı detayı ' + (i + 1) + '/' + alindilar.length,
                 Math.round((yi + yerel) / yillar.length * 100));

        let detaylar = [];
        let hata = '';
        try {
          detaylar = await Istemci.tumSayfalar(
            'odeme-sorgula', detayGovdesi(a, yil), { sayfaBoyutu: 100 });
        } catch (e) {
          // İptal, oturum ve istek limiti tüm işlemi durdurur; tekil hatalar durdurmaz.
          if (e && (e.iptal || e.oturum || e.limit)) throw e;
          hata = 'Detay alınamadı: ' + (e.message || e);
          hataSayisi++;
          Yard.bildir('uyari', (a.alindiNo || '?') + ' → ' + hata);
        }

        if (suzgecVar) {
          if (detaylar.length) {
            detaylar = detaylar.filter(function (d) {
              if (turler.length) {
                const kod = Yard.metin(d.vergiTuru).split('-')[0].trim();
                if (turler.indexOf(kod) === -1) return false;
              }
              if (plaka && plakaSadelestir(d.plakaNo).indexOf(plaka) === -1) return false;

              if (vdKodu) {
                const oid = Yard.metin(d.orgOid).trim();
                if (oid) { if (oid !== vdKodu) return false; }
                else cozulemeyen++;   // daire kodu yok: eleyemeyiz, satır kalır
              }

              if (donemSuz) {
                const ar = donemAralik(d.vergiDonem);
                if (ar) {
                  // Kesişim yoksa satır aralık dışıdır.
                  if (donemBit && ar.bas > donemBit) return false;
                  if (donemBas && ar.bit < donemBas) return false;
                } else {
                  cozulemeyen++;      // dönem okunamadı: eleyemeyiz, satır kalır
                }
              }
              return true;
            });
            if (!detaylar.length) { elenen++; continue; }  // süzgece uymayan alındı yazılmaz
          } else if (!hata) {
            elenen++; continue;   // detayı gerçekten boş olan alındı süzgece uyamaz
          }
          // hata varsa kayıt KALIR: içeriği bilinmediği için sessizce elenmemeli
        }

        toplananlar.push({ yil: yil, alindi: a, detaylar: detaylar, hata: hata });
      }
    }

    if (elenen) Yard.bildir('bilgi', elenen + ' alındı süzgece uymadığı için alınmadı.');
    if (cozulemeyen) {
      Yard.bildir('uyari', cozulemeyen + ' satırın vergi dönemi/dairesi okunamadı; ' +
        'süzgeç dışı bırakılmayıp Excel\'e alındı (veri kaybı olmasın diye).');
    }
    if (hataSayisi) {
      Yard.bildir('uyari', hataSayisi + ' alındının detayı alınamadı. ' +
        'Bu satırlar Excel\'de "Not" sütununda işaretlendi.');
    }
    return { kayitlar: toplananlar };
  }

  /* Panelde gösterilen özet: vergi türü bazında adet ve tutar. */
  function ozet(kayitlar) {
    const grup = {};
    let toplamAdet = 0, toplamTutar = 0;

    for (let i = 0; i < kayitlar.length; i++) {
      const ds = kayitlar[i].detaylar || [];
      if (!ds.length) {
        const e = kayitlar[i].hata ? '(detay alınamadı)' : '(detay satırı yok)';
        grup[e] = grup[e] || { adet: 0, tutar: 0 };
        grup[e].adet++;
        toplamAdet++;
        continue;
      }
      for (let j = 0; j < ds.length; j++) {
        const etiket = Yard.metin(ds[j].vergiTuru) || '(belirsiz)';
        const tutar = Yard.sayiCoz(ds[j].odenen) || 0;
        grup[etiket] = grup[etiket] || { adet: 0, tutar: 0 };
        grup[etiket].adet++;
        grup[etiket].tutar += tutar;
        toplamAdet++;
        toplamTutar += tutar;
      }
    }

    const satirlar = Object.keys(grup).sort().map(function (e) {
      return { etiket: e, adet: grup[e].adet, tutar: grup[e].tutar };
    });
    return { satirlar: satirlar, toplamAdet: toplamAdet, toplamTutar: toplamTutar };
  }

  function excelUret(kayitlar) {
    // Bilinmeyen (yeni) alanları keşfet — hiçbir veri sessizce kaybolmasın
    const ekA = [], ekD = [];
    const gorA = {}, gorD = {};
    for (let i = 0; i < kayitlar.length; i++) {
      const a = kayitlar[i].alindi || {};
      for (const ka in a) {
        if (ALINDI_BILINEN.indexOf(ka) === -1 && !gorA[ka]) { gorA[ka] = 1; ekA.push(ka); }
      }
      const ds = kayitlar[i].detaylar || [];
      for (let j = 0; j < ds.length; j++) {
        for (const kd in ds[j]) {
          if (DETAY_BILINEN.indexOf(kd) === -1 && !gorD[kd]) { gorD[kd] = 1; ekD.push(kd); }
        }
      }
    }

    const sutunlar = SUTUNLAR.slice();
    ekA.forEach(function (ka) {
      sutunlar.push({ ad: 'Alındı: ' + ka, tip: 'metin', genislik: 18,
        al: function (c) { return c.a[ka]; } });
    });
    ekD.forEach(function (kd) {
      sutunlar.push({ ad: 'Detay: ' + kd, tip: 'metin', genislik: 18,
        al: function (c) { return c.d[kd]; } });
    });
    sutunlar.push({ ad: 'Not', tip: 'metin', genislik: 34, al: function (c) { return c.not; } });

    const satirlar = [];
    for (let i = 0; i < kayitlar.length; i++) {
      const k = kayitlar[i];
      const a = k.alindi || {};
      const ham = k.detaylar || [];
      const detaylar = ham.length ? ham : [{}];

      for (let j = 0; j < detaylar.length; j++) {
        const c = {
          yil: k.yil || '',
          a: a,
          d: detaylar[j] || {},
          not: j === 0 ? (k.hata || (ham.length ? '' : 'Detay satırı yok')) : ''
        };
        const satir = [];
        for (let s = 0; s < sutunlar.length; s++) {
          try { satir.push(sutunlar[s].al(c)); } catch (_) { satir.push(''); }
        }
        satirlar.push(satir);
      }
    }

    return { sayfaAdi: 'Veriler', sutunlar: sutunlar, satirlar: satirlar };
  }

  function dosyaAdi(baglam) {
    const ad = Yard.dosyaAdiTemizle(Yard.kisaltUnvan((baglam && baglam.ad) || '', 45));
    const yil = yilEtiketi(baglam && baglam.secim);
    return (ad ? ad + ' ' : '') + 'GİB TAHSİLAT ' + yil + '.xlsx';
  }

  /* ------------------------------------------------------- alındı PDF'leri */

  /*
   * GİB'in kendi "İŞLEM YAP" menüsündeki indirme ucu. Yanıtın biçimi (JSON içinde
   * base64 mü, doğrudan ikili mi) belgelenmediği için ÇALIŞMA ANINDA tanınır:
   * içerik tipine bakılır, JSON ise gövdedeki alanlar taranıp %PDF ile başlayan
   * base64 değer bulunur. Böylece alan adı değişse bile çalışır.
   */
  const PDF_YOL = 'alindi-indir';

  function base64Bayt(s) {
    const ham = atob(String(s).replace(/\s+/g, ''));
    const b = new Uint8Array(ham.length);
    for (let i = 0; i < ham.length; i++) b[i] = ham.charCodeAt(i);
    return b;
  }

  function pdfMi(b) {
    return !!b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  }

  function jsondanPdf(veri) {
    const yigin = [veri];
    let adim = 0;
    while (yigin.length && adim++ < 5000) {
      const d = yigin.pop();
      if (!d || typeof d !== 'object') continue;
      for (const k in d) {
        const v = d[k];
        if (typeof v === 'string' && v.length > 200) {
          try {
            const b = base64Bayt(v);
            if (pdfMi(b)) return b;
          } catch (_) {}
        } else if (v && typeof v === 'object') {
          yigin.push(v);
        }
      }
    }
    return null;
  }

  /* Yanıttaki rapor bağlantısını bul: önce bilinen alan, sonra URL benzeri herhangi bir alan */
  function jsondanBaglanti(veri) {
    if (!veri || typeof veri !== 'object') return '';
    const dogrudan = Yard.metin(veri.reportLink).trim();
    if (dogrudan) return dogrudan;

    const yigin = [veri];
    let adim = 0;
    while (yigin.length && adim++ < 2000) {
      const d = yigin.pop();
      if (!d || typeof d !== 'object') continue;
      for (const k in d) {
        const v = d[k];
        if (typeof v === 'string' && /^(https?:\/\/|\/)\S+$/i.test(v) && v.length > 10) return v;
        if (v && typeof v === 'object') yigin.push(v);
      }
    }
    return '';
  }

  async function baglantidanPdf(bag) {
    const url = /^https?:\/\//i.test(bag) ? bag : (bag.charAt(0) === '/' ? bag : '/' + bag);
    const yanit = await Istemci.getHam(url, 2);
    const bayt = new Uint8Array(await yanit.arrayBuffer());
    if (pdfMi(bayt)) return bayt;
    try {
      const b2 = base64Bayt(new TextDecoder().decode(bayt).trim());
      if (pdfMi(b2)) return b2;
    } catch (_) {}
    throw new Error('Rapor bağlantısından gelen içerik PDF değil.');
  }

  /*
   * Alındı PDF'i İKİ ADIMLI gelir (gerçek GİB yanıtıyla doğrulandı):
   *   1) alindi-indir  ->  { messages: null, reportLink: "<mutlak adres>" }
   *   2) o adresten GET ->  PDF baytları
   * Yine de gövdeye gömülü base64 ve doğrudan ikili yanıt yolları yedek olarak
   * korunur; GİB biçimi değiştirirse script çalışmaya devam etsin.
   */
  async function alindiPdf(alindi, yil) {
    const yanit = await Istemci.ham(PDF_YOL, {
      meta: { pagination: { pageNo: 1, pageSize: 10 }, sortFieldName: 'id', sortType: 'ASC', filters: [] },
      data: { alindiNo: alindi.alindiNo, secureId: alindi.secureId, yil: String(yil) }
    }, 2);

    const tip = (yanit.headers.get('content-type') || '').toLowerCase();

    if (tip.indexOf('json') !== -1) {
      const veri = await yanit.json();
      const gomulu = jsondanPdf(veri);
      if (gomulu) return gomulu;

      const bag = jsondanBaglanti(veri);
      if (bag) return await baglantidanPdf(bag);

      throw new Error('Yanıtta PDF verisi veya rapor bağlantısı yok.');
    }

    const bayt = new Uint8Array(await yanit.arrayBuffer());
    if (pdfMi(bayt)) return bayt;
    try {
      const b2 = base64Bayt(new TextDecoder().decode(bayt).trim());
      if (pdfMi(b2)) return b2;
    } catch (_) {}
    throw new Error('Yanıt PDF değil (' + (tip || 'tip belirtilmemiş') + ').');
  }

  /*
   * Her tahsilatın indirilebilir alındısı yoktur; GİB bunu liste yanıtındaki
   * `indir` bayrağıyla bildirir ("1" = İŞLEM YAP menüsünde "Alındı İndir" çıkar).
   * Bayrağa bakmak menüyü DOM'dan taramaktan hem kesin hem bedavadır: bilgi
   * zaten elimizdeki yanıtta var, ek istek gerekmez.
   */
  function pdfVarMi(alindi) {
    return Yard.metin((alindi || {}).indir).trim() === '1';
  }

  /* Sonuç kümesinde kaç alındının PDF'i var? -> {indirilebilir, toplam} */
  function pdfSayisi(kayitlar) {
    const gorulen = {};
    let indirilebilir = 0, toplam = 0;
    for (let i = 0; i < (kayitlar || []).length; i++) {
      const a = kayitlar[i].alindi || {};
      if (!a.alindiNo || gorulen[a.alindiNo]) continue;
      gorulen[a.alindiNo] = 1;
      toplam++;
      if (pdfVarMi(a)) indirilebilir++;
    }
    return { indirilebilir: indirilebilir, toplam: toplam };
  }

  function pdfAdi(kayit) {
    const a = kayit.alindi || {};
    const d = Yard.tarihCoz(a.islemTarihi);
    const p = function (n) { return String(n).padStart(2, '0'); };
    const tarih = d ? (d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()))
                    : (kayit.yil || '');
    const no = Yard.dosyaAdiTemizle(a.alindiNo || 'alindi');
    return (tarih ? tarih + '_' : '') + no + '.pdf';
  }

  /* kayitlar -> [{ad, veri}] ; iptal ve oturum hataları yukarı fırlar */
  async function pdfleriTopla(kayitlar, ilerleme, cikti) {
    const gorulen = {};
    const hedef = pdfSayisi(kayitlar).indirilebilir;
    let hata = 0, atlanan = 0, sira = 0;

    if (!hedef) {
      Yard.bildir('uyari', 'Bu sonuçtaki hiçbir tahsilatın indirilebilir alındısı yok.');
      return cikti;
    }

    for (let i = 0; i < kayitlar.length; i++) {
      Istemci.iptalKontrol();
      const k = kayitlar[i];
      const a = k.alindi || {};
      if (!a.alindiNo || !a.secureId || gorulen[a.alindiNo]) continue;
      gorulen[a.alindiNo] = 1;
      if (!pdfVarMi(a)) { atlanan++; continue; }   // bu tahsilatın alındısı indirilemiyor

      sira++;
      ilerleme('Alındı PDF ' + sira + '/' + hedef, Math.round(sira / hedef * 100));
      try {
        cikti.push({ ad: pdfAdi(k), veri: await alindiPdf(a, k.yil) });
      } catch (e) {
        if (e && (e.iptal || e.oturum || e.limit)) throw e;
        hata++;
        Yard.bildir('uyari', (a.alindiNo || '?') + ' PDF alınamadı: ' + (e.message || e));
      }
    }

    if (atlanan) {
      Yard.bildir('bilgi', atlanan + ' tahsilatta indirilebilir alındı yok, atlandı.');
    }
    if (hata) Yard.bildir('uyari', hata + ' alındının PDF\'i alınamadı.');
    return cikti;
  }

  function pdfZipAdi(baglam) {
    const ad = Yard.dosyaAdiTemizle(Yard.kisaltUnvan((baglam && baglam.ad) || '', 45));
    return (ad ? ad + ' ' : '') + 'GİB ALINDI ' + yilEtiketi(baglam && baglam.secim) + '.zip';
  }

  return {
    baslik: 'Ödeme Alındılarım ve Tahsilat Bilgilerim',
    alanlar: ALANLAR,
    ekAksiyonlar: [{ ad: 'Yılları yenile', calistir: yillariYenile }],
    filtreleriYukle: filtreleriYukle,
    turleriYukle: turleriYukle,
    topla: topla,
    ozet: ozet,
    excelUret: excelUret,
    dosyaAdi: dosyaAdi,
    pdfleriTopla: pdfleriTopla,
    pdfSayisi: pdfSayisi,
    pdfZipAdi: pdfZipAdi,
    mukellefBul: mukellefBul
  };
})();

/* ==================== 90-baslat.js ==================== */
/*
 * Başlatıcı.
 *
 * Panel sitenin HER sayfasında, sağ altta küçük bir düğme olarak durur. İlgili GİB
 * ekranına gitmeye gerek yoktur.
 *
 * Ayrıca oturum kimliği izlenir: mükellef değişince (çıkış → başka mükellefle giriş)
 * veya oturum kapanınca panel kendini sıfırlar. Aksi hâlde önceki mükellefin
 * sonuçları/süzgeçleri ekranda kalır ve karışıklığa yol açar.
 *
 * Not: sessionStorage sekmeyle birlikte silindiği için tarayıcı veya site kapatılıp
 * açıldığında panel zaten sıfırdan başlar.
 */

(function () {

  const EKRANLAR = [Ekran];
  let sonKimlik = null;

  /* Oturumdaki mükellefin kimliği; oturum yoksa boş dizi döner. */
  function kimlik() {
    try {
      if (!sessionStorage.getItem('token')) return '';
      const u = JSON.parse(sessionStorage.getItem('userInfo') || 'null');
      if (!u) return 'oturum';
      return String(u.vkn || u.tckn || u.userCode || 'oturum');
    } catch (_) {
      return '';
    }
  }

  function kontrol() {
    try {
      if (!Arayuz.varMi()) {
        // Panel SPA tarafından silinip yeniden kuruluyor olabilir. Bu arada
        // mükellef değişmişse sessizce yutulmamalı: kullanıcı bilgilendirilir.
        // (Arayuz.kur() modül durumunu zaten koşulsuz sıfırlar.)
        Arayuz.kur(EKRANLAR);
        const yeni = kimlik();
        if (sonKimlik !== null && yeni !== sonKimlik) {
          Arayuz.sifirla(yeni ? 'Mükellef değişti — panel sıfırlandı.'
                              : 'Oturum kapandı — panel sıfırlandı.');
        }
        sonKimlik = yeni;
        return;
      }
      const k = kimlik();
      if (sonKimlik === null) { sonKimlik = k; return; }
      if (k === sonKimlik) return;

      const oncekiVardi = !!sonKimlik;
      sonKimlik = k;
      if (k) {
        Arayuz.sifirla(oncekiVardi ? 'Mükellef değişti — panel sıfırlandı.' : null);
      } else {
        Arayuz.sifirla('Oturum kapandı — panel sıfırlandı.');
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kontrol, { once: true });
  } else {
    kontrol();
  }
  setInterval(kontrol, 1500);

  /* Sorun giderme için konsoldan erişim: __gibTahsilat.ekran / .kanca … */
  try {
    window.__gibTahsilat = {
      yardimci: Yard, kanca: Kanca, istemci: Istemci,
      zip: Zip, xlsx: Xlsx, arayuz: Arayuz, ekran: Ekran
    };
  } catch (_) {}
})();

})();
