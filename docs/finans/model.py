#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Siparişin Önünde — 24 aylık finansal model (Ekim 2026 – Eylül 2028)

Kullanım (repo kökünden):
    python3 docs/finans/model.py            # CSV'leri yazar + özet tabloları Markdown olarak ekrana basar
    python3 docs/finans/model.py --sessiz   # yalnız CSV'leri yazar

Çıktılar (bu dosyanın klasörüne):
    senaryo-go.csv, senaryo-kosullu.csv, senaryo-nogo.csv   aylık ayrıntı (24 satır)
    senaryo-ozet.csv                                        senaryo, duyarlılık ve varyant özetleri

Kurallar:
  * Tüm girdiler aşağıdaki VARSAYIMLAR sözlüğündedir; senaryo farkları SENARYOLAR'dadır.
    Kurucu yalnız bu iki sözlüğü değiştirip betiği yeniden çalıştırır.
  * Yorumlardaki etiketler: [00 §8] gibi kaynak doküman; [T] = tahmin, kurucu güncellemeli.
  * Tutarlar KDV hariç, nominal TL'dir. Kurumlar vergisi ve KDV nakit zamanlaması modelde yoktur.
  * Yalnız Python standart kütüphanesi kullanılır.
"""
import copy
import csv
import math
import os
import sys

# =============================================================================
# 1) VARSAYIMLAR — (GO senaryosunun değerleri; diğer senaryolar aşağıda değiştirir)
# =============================================================================
VARSAYIMLAR = {
    # ---------------- Zaman ve makro ----------------
    "ay_sayisi": 24,                    # Ay 1 = Ekim 2026 ... Ay 24 = Eylül 2028
    "kur_usd_try": 48.4,                # [00 §8] TCMB, 24.09.2026
    "kur_yillik_artis": 0.20,           # [T] TL'nin USD karşısında yıllık nominal değer kaybı
    "kur_carpani": 1.0,                 # duyarlılık: döviz bazlı maliyetlere seviye şoku
    "tufe_yillik": 0.25,                # [T] planlama varsayımı, tahmin değil (vekil: arastirma/06 §7.6)
    "maas_artisi_ocak": 0.25,           # [T] her Ocak (Ay 4 = Oca 2027, Ay 16 = Oca 2028) tüm maaşlara
    "ocak_aylari": [4, 16],

    # ---------------- Fiyat [00 §8] ----------------
    "liste_fiyat": {"esnaf": 990, "pro": 1790, "zincir": 2990},  # TL/ay KDV hariç; Zincir şube başına, şube indirimi yok [00 §13.13]
    "fiyat_carpani": 1.0,               # duyarlılık: liste fiyatı çarpanı
    "zincir_ort_sube": 3,               # [T] Zincir müşterisinin ortalama şube sayısı
    "yillik_indirim": 0.20,             # [00 §8] yıllık peşinde %20
    "kurucu_uye_indirim": 0.30,         # [00 §8] 12 ay sabit %30 indirim ORANI
    "kurucu_uye_ay": 12,                # [00 §8]
    "kurucu_uye_kota": 100,             # [00 §8] ilk 100 ücretli işletme, pilotlar dahil [00 §13.14]
    "kurulum_ucreti": 1990,             # [00 §8] "biz kuralım"; ilk 100'e ücretsiz
    "kurulum_alan_payi": 0.30,          # [T] 100. işletmeden sonra ücretli kurulumu seçen pay
    "fiyat_guncelleme_aylari": [16],    # [T] TÜFE güncellemesi Ocak 2028 (yılda 1). Yılda 2: [10, 16, 22]
    "fiyat_guncelleme_periyot": 12,     # güncelleme başına kaç aylık TÜFE yansıtılır (yılda 2 ise 6)

    # ---------------- Pilot [00 §8, §11] ----------------
    "pilot_ay": 3,                      # Aralık 2026 (Dalga 1–3: 7, 14, 21 Aralık)
    "pilot_sayisi": 10,
    "pilot_ucretsiz_ay": 3,             # [00 §8] → Mart 2027'de ücretliye geçiş [09 §1.1]
    "pilot_donusum": 0.80,              # [T] K4 eşiği ≥ %60 [10 §8.7 P9]
    "pilot_paket": {"esnaf": 0.30, "pro": 0.70},  # [T]

    # ---------------- Büyüme ----------------
    "lansman_ay": 5,                    # 15 Şubat 2027 [00 §11]
    # (başlangıç ayı, bitiş ayı, aylık BRÜT yeni ödeyen işletme) — deneme sonrası ödemeye geçen
    "yeni_isletme": [(5, 5, 12), (6, 9, 25), (10, 10, 50), (11, 11, 80), (12, 12, 100),
                     (13, 13, 120), (14, 24, 140)],      # [01 §8.3–8.4: 20–25/ay, sonra ~100 net/ay]
    # (uzatılmış projeksiyonda son aralığın değeri Ay 24'ten sonra da sürer)
    "yeni_isletme_carpani": 1.0,        # duyarlılık
    "paket_karmasi": {"esnaf": 0.35, "pro": 0.60, "zincir": 0.05},  # [T]
    "zincir_satis_ay": 10,              # [00 §8] Zincir Faz 2'de; F2-15 Haz 2027 [09 §8.1] → Tem 2027
    "esnaf_talep_carpani": 1.0,         # Esnaf seçenek analizi için
    "esnaf_yalniz_yillik": False,       # Esnaf seçenek C
    "yillik_odeme_payi": 0.25,          # [T] kurucu üye olmayanlarda; kurucu üye indirimiyle birleşmez [00 §13.14]
    "deneme_ay": 1,                     # 14 gün deneme → ödeme katılım ayından sonraki ay başlar
    "churn_ilk_yil": 0.05,              # [00 §12] ilk yıl %5–7 (aylık logo churn)
    "churn_sonra": 0.025,               # [00 §12] sonra < %3
    "churn_gecis_ay": 17,               # lansmandan 12 ay sonra (Şubat 2028)
    "churn_delta": 0.0,                 # duyarlılık (puan); taban %1

    # ---------------- Kanal karması ve edinme maliyeti ----------------
    "bayi_baslangic_ay": 9,             # bayi paneli F2-12 Mayıs 2027 [09 §8.1] → Haz 2027
    "kanal_bayi_oncesi": {"saha": 0.70, "referans": 0.10, "organik": 0.20},               # [T]
    "kanal_bayi_sonrasi": {"saha": 0.45, "bayi": 0.20, "referans": 0.15, "organik": 0.20},  # [T]
    "saha_kapanis_kisi_ay": 20,         # [01 §7.3] temsilci başına ayda ~20 kapanış
    "bayi_komisyon": 0.30,              # [01 §7.3 öneri] ilk 12 ay aylık ücretin %30'u
    "bayi_komisyon_ay": 12,
    "referans_ucretsiz_ay": 2,          # [01 §7.3] getiren + gelen 1'er ay ücretsiz
    "basili_materyal": 750,             # [01 §7.3] 500–1.000 TL/yeni işletme
    "organik_reklam_cac": 1500,         # [T] organik/içerik kanalında reklam, hedef < 2.000 [01 §7.3]
    "etkinlik_aylik": 10000,            # [T] esnaf odası/dernek etkinlikleri, lansman+1'den
    "ikinci_sehir_ay": 10,              # F3-02 Tem 2027 [09 §1.3]
    "ikinci_sehir_acilis": 150000,      # [T] tek seferlik açılış (yol, konaklama, etkinlik)
    "cac_carpani": 1.0,                 # duyarlılık: tüm satış-pazarlama giderleri

    # ---------------- Personel (işverene maliyet, TL/ay, Eylül 2026 fiyatıyla) ----------------
    "kurucu_sayisi": 2,                 # KUR + OPS [09 §9.1]
    "kurucu_maas": 75000,               # [T] piyasa altı kurucu maaşı
    "G_gelistirici": 2,                 # [09 §10.1] G: TL + FE
    "M_gelistirici_maas": 175000,       # [T] [09 §10.1] M: orta-kıdemli geliştirici, işverene maliyet
    "gelistirici3_ay": 4,               # [09 §9.2] Faz 2 başı (H14 = Oca 2027)
    "destek_maas": 60000,               # [09 §9.2, arastirma/02 §8]
    "destek_oran_ilk": 150,             # [01 §7.1, 09 §9.2] uzman başına işletme (2. uzman ~150'de)
    "destek_oran_sonra": 250,           # [T] self-servis + bayi 1. seviye destek sonrası (01 §7.2: ≥ 300 hedef)
    "destek_oran_gecis_ay": 17,
    "esnaf_destek_agirligi": 1.0,       # Esnaf seçenek analizi (self-servis ağırlıklı destek)
    "saha_maas": 70000,                 # [09 §9.2] maaş + prim + yol
    "icerik_ay": 6, "icerik_maas": 30000,       # [09 §9.2] yarı zamanlı içerik Ay 5–6; tutar [T]
    "bayi_yon_ay": 9, "bayi_yon_maas": 90000,   # [09 §9.2] Ay 8–9; tutar [T]
    "sre_esik": 300, "sre_maas": 75000,         # [09 §9.2] 300+ işletmede yarı zamanlı SRE; tutar [T]
    "teknokent_ay": None,               # Teknokent varyantı: örn. 4 (Oca 2027)
    "teknokent_arge_tasarruf": 0.20,    # [T] Ar-Ge personeli maliyetinde vergi/SGK teşviki etkisi (mali müşavirle teyit)
    "teknokent_kira": 20000,            # [T] bölgede ofis kirası + yönetim gideri

    # ---------------- COGS ----------------
    # Altyapı (LLM, SMS, platform WABA hariç) USD/ay — aktif işletme sayısına göre parça parça doğrusal [06 §17]
    "altyapi_usd_egri": [(0, 60), (30, 150), (100, 650), (300, 1300), (1000, 2750)],
    "altyapi_usd_marjinal": 2.2,        # 1.000 üstünde işletme başı USD [01 §7.1: $2–3,5]
    "altyapi_yurtdisi_payi": 0.40,      # [T] yurt dışı faturalı kısım (Cloudflare, Sentry...) — koruyucu metrik için
    "llm_baslangic_ay": 8,              # AI sipariş F2-09 Nis 2027 [09 §8.1] → Mayıs 2027
    "llm_usd_isletme": 2.3,             # [06 §17] $1,35–3,24; Pro ve Zincir şubesi başına [00 §13.8]
    "sms_kota": {"esnaf": 100, "pro": 300, "zincir": 300},  # [00 §4] Zincir şube başına
    "sms_kota_kullanim": 0.20,          # [T] kotanın kullanılan payı (06 §17 tipik ≈ %9)
    "sms_birim_tl": 0.30,               # [01 §7.1] 0,16–0,43 TL/SMS
    "waba_usd_isletme": 0.04,           # [06 §17] platform uyarı şablonları
    "psp_oran": 0.025,                  # [01 §7.1] %2–3
    "kart_payi_aylik": 1.0,             # [T]
    "kart_payi_yillik": 0.5,            # [T] yıllıkta havale/EFT payı
    "efatura_aylik": 1500,              # [T] Paraşüt paketi (teklif)
    "efatura_baslangic_ay": 4,

    # ---------------- Genel yönetim ve tek seferlik ----------------
    "arac_usd_kisi": 80,                # [T] GitHub, Claude, Workspace, tasarım araçları (yurt dışı)
    "mali_musavir": 8000,               # [T] teklif
    "hukuk_uyum_paketi": 150000,        # [T] teklif [08 §7.4]
    "hukuk_uyum_aylari": [1, 2, 3],
    "hukuk_surekli": 15000,             # [T] lansmandan itibaren
    "sirket_kurulus": 20000,            # [T] tescil, noter, harç
    "marka_tescil": 30000,              # [T] 4 sınıf + vekil [08 §7.3]
    "tasarim": 40000,                   # [T] logo, basılı şablon, site görselleri
    "pentest": 250000,                  # [T] teklif [06 §15.8]; yıllık tekrar
    "pentest_ay": 4,                    # H16–H18 [09 §8.1]
    "pilot_tablet": 37500,              # [T] 5 × 7.500 TL ödünç tablet [09 §10.2 #15]
    "d5_reklam": 20000,                 # [T] Ay 1–2, kurucu kararı [09 §10.2 #13]
    "d3_basili": 6000,                  # [09 §10.2 #12] ≈ 8 işletme × 750 (pilot kitleri ayrıca)
    "kurucu_saha_yol": 10000,           # [T] Faz 0–1 saha ve yol
    "kurucu_saha_yol_bitis": 4,
    "beklenmeyen_orani": 0.10,          # [09 §10.2 #19] personel dışı opex'e %10

    # ---------------- Sermaye kuralı [00 §12] ----------------
    "tampon": 0.20,                     # açığa %20 tampon
    "pist_ay": 9,                       # nakit pisti ≥ 9 ay
    "hedef_geri_odeme_ay": 4,           # [00 §12] geri ödeme < 4 ay
    # Finansman kilometre taşları (ay no → ad) [09 §1.1]
    "kilometre_taslari": {2: "K2 go/no-go", 3: "Pilot başlar", 5: "K4 + ticari lansman",
                          9: "≈100 işletme (Faz 2 sonu)", 12: "Faz 3 ilk çeyreği", 18: "≈1.000 işletme hedefi",
                          24: "Model sonu"},

    # ---------------- Hisse yapısı örneği [T] (08 §7.1) ----------------
    "hisse_kurulus": {"Kurucu 1 (KUR)": 0.45, "Kurucu 2 (OPS)": 0.30,
                      "Teknik lider (kurucu ortak olarak katılırsa)": 0.10, "Opsiyon havuzu (ayrılmış)": 0.15},
    "pre_seed_seyrelme": 0.15,          # [T] örnek; tur büyüklüğü ve değerleme piyasaya bağlı
}

# Senaryolar: yalnız değişen anahtarlar. K2 = Hafta 8 go/no-go, K4 = ticari lansman kapısı [09 §4.6, §7.7]
SENARYOLAR = {
    "nogo": {
        "ad": "NO-GO / pivot",
        # K2 NO-GO (20 Kas 2026): S5–S6 durur, pilot yok; 2 hafta pivot değerlendirmesi, yeni hipotezle
        # 3 ay yeniden kurgu, Mart 2027'de 5 işletmelik pivot pilotu, Haziran 2027'de lansman [T]
        "pilot_ay": 6, "pilot_sayisi": 5, "pilot_donusum": 0.60,
        "lansman_ay": 9,
        "yeni_isletme": [(9, 9, 4), (10, 12, 8), (13, 18, 12), (19, 24, 15)],
        "paket_karmasi": {"esnaf": 0.40, "pro": 0.60, "zincir": 0.0},
        "zincir_satis_ay": None,
        "yillik_odeme_payi": 0.15,
        "churn_ilk_yil": 0.07, "churn_sonra": 0.04, "churn_gecis_ay": 21,
        "bayi_baslangic_ay": None, "gelistirici3_ay": None, "icerik_ay": 13,
        "bayi_yon_ay": None, "ikinci_sehir_ay": None,
        "pentest_ay": 8, "llm_baslangic_ay": 12, "efatura_baslangic_ay": 8,
        "kurucu_saha_yol_bitis": 8,
    },
    "kosullu": {
        "ad": "KOŞULLU",
        # K2 KOŞULLU: pilot 6 işletme (3+3), Faz 2'ye kaynak ayrılmaz; K4 geçer, lansman 15 Şub 2027,
        # yavaş büyüme; işe alımlar tetiklerle gecikir [09 §4.7]
        "pilot_sayisi": 6, "pilot_donusum": 0.60,
        "yeni_isletme": [(5, 5, 6), (6, 9, 10), (10, 12, 20), (13, 18, 35), (19, 24, 45)],
        "paket_karmasi": {"esnaf": 0.45, "pro": 0.52, "zincir": 0.03},
        "zincir_satis_ay": 13,
        "yillik_odeme_payi": 0.20,
        "churn_ilk_yil": 0.06, "churn_sonra": 0.03,
        "bayi_baslangic_ay": 12,
        "kanal_bayi_sonrasi": {"saha": 0.55, "bayi": 0.15, "referans": 0.15, "organik": 0.15},
        # yalın ekip: 3. geliştirici, bayi yöneticisi ve ikinci şehir 24 ay içinde yok
        "gelistirici3_ay": None, "icerik_ay": 12, "bayi_yon_ay": None, "ikinci_sehir_ay": None,
        "llm_baslangic_ay": 10,
    },
    "go": {
        "ad": "GO",
        # K2 GO + K4 GO: 01 §8 GTM hızı; ~100 işletme Haz 2027, ~1.000 işletme Mar 2028 hedefi
    },
}
SENARYO_SIRASI = ["nogo", "kosullu", "go"]

AY_ADLARI = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]
PAKETLER = ["esnaf", "pro", "zincir"]


# =============================================================================
# 2) Yardımcılar
# =============================================================================
def ay_etiketi(m):
    """Ay 1 = Eki 2026."""
    yil = 2026 + (9 + m - 1) // 12
    ay = (9 + m - 1) % 12
    return f"{AY_ADLARI[ay]} {yil}"


def ay_kodu(m):
    yil = 2026 + (9 + m - 1) // 12
    ay = (9 + m - 1) % 12 + 1
    return f"{yil}-{ay:02d}"


def ceyrek_etiketi(m):
    yil = 2026 + (9 + m - 1) // 12
    ay = (9 + m - 1) % 12 + 1
    return f"{yil} Ç{(ay - 1) // 3 + 1}"


def birlestir(taban, degisiklik):
    s = copy.deepcopy(taban)
    for k, v in degisiklik.items():
        s[k] = copy.deepcopy(v)
    return s


def aralik_degeri(araliklar, m):
    for bas, bit, deger in araliklar:
        if bas <= m <= bit:
            return deger
    if araliklar and m > max(b for _, b, _ in araliklar):
        return araliklar[-1][2]          # uzatılmış projeksiyon: son hız sürer
    return 0


def parcali(egri, x, marjinal):
    if x <= egri[0][0]:
        return egri[0][1]
    for (x0, y0), (x1, y1) in zip(egri, egri[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    xs, ys = egri[-1]
    return ys + (x - xs) * marjinal


def tr(sayi, ondalik=0):
    """Türkçe sayı biçimi: 1.234.567,8"""
    if sayi is None:
        return "—"
    s = f"{abs(sayi):,.{ondalik}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−" if sayi < 0 and round(abs(sayi), ondalik) != 0 else "") + s


def mn(sayi):
    return tr(sayi / 1e6, 1) + " mn TL"


def yuzde(x, ondalik=0):
    return "—" if x is None else "%" + tr(100 * x, ondalik)


# =============================================================================
# 3) Model
# =============================================================================
def simule_et(V):
    N = V["ay_sayisi"]
    satirlar = []
    kohortlar = []
    kurucu_kalan = V["kurucu_uye_kota"]
    ertelenen = {}           # ay -> referans indirimi (sonraki ay)

    def maas_endeksi(m):
        return (1 + V["maas_artisi_ocak"]) ** sum(1 for o in V["ocak_aylari"] if o <= m)

    def tufe_endeksi(m):
        return (1 + V["tufe_yillik"]) ** ((m - 1) / 12)

    def kur(m):
        return V["kur_usd_try"] * (1 + V["kur_yillik_artis"]) ** ((m - 1) / 12) * V["kur_carpani"]

    def fiyat_endeksi(m):
        oran = (1 + V["tufe_yillik"]) ** (V["fiyat_guncelleme_periyot"] / 12) - 1
        return (1 + oran) ** sum(1 for u in V["fiyat_guncelleme_aylari"] if u <= m)

    def liste(p, m):
        return V["liste_fiyat"][p] * V["fiyat_carpani"] * fiyat_endeksi(m)

    def subesi(p):
        return V["zincir_ort_sube"] if p == "zincir" else 1

    def churn(m):
        c = V["churn_ilk_yil"] if m < V["churn_gecis_ay"] else V["churn_sonra"]
        return max(0.01, c + V["churn_delta"])

    def kohort_ekle(j, p, adet, kurucu, yillik, pilot, bayi, odeme_bas):
        if adet <= 1e-9:
            return
        kohortlar.append(dict(j=j, p=p, n=adet, kurucu=kurucu, yillik=yillik, pilot=pilot,
                              bayi=bayi, odeme_bas=odeme_bas, donem_fiyat=0.0))

    kum_nakit = 0.0
    for m in range(1, N + 1):
        r = {"ay_no": m, "ay": ay_kodu(m)}
        kr = kur(m)

        # ---------- 3.1 Yeni işletmeler ----------
        yeni = 0.0
        yeni_saha = yeni_org = 0.0
        kurulum_geliri = 0.0
        basili = 0.0
        if m == V["pilot_ay"]:
            ps = V["pilot_sayisi"]
            kurucu_kalan -= min(kurucu_kalan, ps * V["pilot_donusum"])   # dönüşecek pilotlara kurucu üye kotası
            for p, pay in V["pilot_paket"].items():
                kohort_ekle(m, p, ps * pay, True, False, True, False, m + V["pilot_ucretsiz_ay"])
            basili += ps * V["basili_materyal"] * tufe_endeksi(m)
        if m >= V["lansman_ay"]:
            toplam = aralik_degeri(V["yeni_isletme"], m) * V["yeni_isletme_carpani"]
            karma = dict(V["paket_karmasi"])
            if not V["zincir_satis_ay"] or m < V["zincir_satis_ay"]:
                karma["zincir"] = 0.0
            karma["esnaf"] *= V["esnaf_talep_carpani"]
            s = sum(V["paket_karmasi"][p] for p in PAKETLER if (p != "zincir" or karma["zincir"] > 0))
            adetler = {p: toplam * karma[p] / s for p in PAKETLER}
            yeni = sum(adetler.values())
            bayi_acik = V["bayi_baslangic_ay"] and m >= V["bayi_baslangic_ay"]
            kanal = V["kanal_bayi_sonrasi"] if bayi_acik else V["kanal_bayi_oncesi"]
            b_pay = kanal.get("bayi", 0.0)
            yeni_saha, yeni_org = yeni * kanal.get("saha", 0), yeni * kanal.get("organik", 0)
            k_oran = min(kurucu_kalan, yeni) / yeni if yeni > 0 else 0
            kurucu_kalan -= yeni * k_oran
            odeme_bas = m + V["deneme_ay"]
            ref_indirim = 0.0
            for p in PAKETLER:
                n_p = adetler[p]
                if n_p <= 0:
                    continue
                n_k, n_nk = n_p * k_oran, n_p * (1 - k_oran)
                y_pay = 1.0 if (p == "esnaf" and V["esnaf_yalniz_yillik"]) else V["yillik_odeme_payi"]
                for bayi, bp in ((True, b_pay), (False, 1 - b_pay)):
                    kohort_ekle(m, p, n_k * bp, True, False, False, bayi, odeme_bas)
                    kohort_ekle(m, p, n_nk * (1 - y_pay) * bp, False, False, False, bayi, odeme_bas)
                    kohort_ekle(m, p, n_nk * y_pay * bp, False, True, False, bayi, odeme_bas)
                kurulum_geliri += n_nk * V["kurulum_alan_payi"] * V["kurulum_ucreti"] \
                    * V["fiyat_carpani"] * fiyat_endeksi(m)
                ort_indirim = k_oran * (1 - V["kurucu_uye_indirim"]) + (1 - k_oran)
                ref_indirim += n_p * kanal.get("referans", 0) * V["referans_ucretsiz_ay"] \
                    * liste(p, m) * subesi(p) * ort_indirim
            ertelenen[odeme_bas] = ertelenen.get(odeme_bas, 0) + ref_indirim
            basili += yeni * V["basili_materyal"] * tufe_endeksi(m)

        # ---------- 3.2 Churn ----------
        churn_adet = 0.0
        for k in kohortlar:
            if k["j"] == m:
                continue
            if k["pilot"] and m == k["odeme_bas"]:
                kayip = k["n"] * (1 - V["pilot_donusum"])
                k["n"] -= kayip
                churn_adet += kayip
                continue
            if m <= k["odeme_bas"]:
                continue
            if k["yillik"]:
                if (m - k["odeme_bas"]) % 12 == 0:
                    hayatta = 1.0
                    for t in range(m - 11, m + 1):
                        hayatta *= (1 - churn(t))
                    kayip = k["n"] * (1 - hayatta)
                    k["n"] -= kayip
                    churn_adet += kayip
            else:
                kayip = k["n"] * churn(m)
                k["n"] -= kayip
                churn_adet += kayip

        # ---------- 3.3 Gelir ----------
        mrr = 0.0
        aylik_tahsil = 0.0
        yillik_tahsil = 0.0
        bayi_komisyonu = 0.0
        aktif = odeyen = 0.0
        paket_adet = {p: 0.0 for p in PAKETLER}
        aktif_pro_sube = 0.0
        destek_yuk = 0.0
        sms_adet = 0.0
        for k in kohortlar:
            n = k["n"]
            aktif += n
            p = k["p"]
            paket_adet[p] += n
            if p == "esnaf":
                destek_yuk += n * V["esnaf_destek_agirligi"]
            else:
                aktif_pro_sube += n * subesi(p)
                destek_yuk += n * subesi(p)
            sms_adet += n * V["sms_kota"][p] * subesi(p) * V["sms_kota_kullanim"]
            if m < k["odeme_bas"]:
                continue
            odeyen += n
            if k["yillik"]:
                if (m - k["odeme_bas"]) % 12 == 0:
                    k["donem_fiyat"] = liste(p, m) * subesi(p) * (1 - V["yillik_indirim"])
                    yillik_tahsil += 12 * k["donem_fiyat"] * n
                gelir_k = k["donem_fiyat"] * n
            else:
                indirim = V["kurucu_uye_indirim"] if (k["kurucu"] and m - k["odeme_bas"] < V["kurucu_uye_ay"]) else 0
                gelir_k = liste(p, m) * subesi(p) * (1 - indirim) * n
                aylik_tahsil += gelir_k
            mrr += gelir_k
            if k["bayi"] and m - k["odeme_bas"] < V["bayi_komisyon_ay"]:
                bayi_komisyonu += V["bayi_komisyon"] * gelir_k

        ref_indirimi = ertelenen.get(m, 0.0)
        abonelik_geliri = mrr - ref_indirimi
        toplam_gelir = abonelik_geliri + kurulum_geliri
        yillik_taninan = mrr - aylik_tahsil
        nakit_giris = aylik_tahsil + yillik_tahsil + kurulum_geliri - ref_indirimi

        # ---------- 3.4 Personel ----------
        me = maas_endeksi(m)
        lansman = m >= V["lansman_ay"]
        n_destek = 0
        if lansman:
            oran = V["destek_oran_ilk"] if m < V["destek_oran_gecis_ay"] else V["destek_oran_sonra"]
            n_destek = max(1, math.ceil(destek_yuk / oran - 1e-9))
        n_saha = math.ceil(yeni_saha / V["saha_kapanis_kisi_ay"] - 1e-9) if lansman and yeni_saha > 0 else 0
        n_dev = V["G_gelistirici"] + (1 if V["gelistirici3_ay"] and m >= V["gelistirici3_ay"] else 0)
        sre = 0.5 if aktif >= V["sre_esik"] else 0
        icerik = 0.5 if V["icerik_ay"] and m >= V["icerik_ay"] else 0
        bayi_yon = 1 if V["bayi_yon_ay"] and m >= V["bayi_yon_ay"] else 0

        tekno = V["teknokent_ay"] and m >= V["teknokent_ay"]
        arge_carpan = (1 - V["teknokent_arge_tasarruf"]) if tekno else 1.0
        p_kurucu = V["kurucu_sayisi"] * V["kurucu_maas"] * me
        p_arge = (n_dev * V["M_gelistirici_maas"] + (V["sre_maas"] if sre else 0)) * me * arge_carpan
        p_destek = n_destek * V["destek_maas"] * me
        # icerik: 0,5 FTE; icerik_maas zaten yarı zamanlı ücrettir
        p_satis = (n_saha * V["saha_maas"] + (V["icerik_maas"] if icerik else 0)
                   + bayi_yon * V["bayi_yon_maas"]) * me
        kisi = V["kurucu_sayisi"] + n_dev + sre + n_destek + n_saha + icerik + bayi_yon

        # ---------- 3.5 COGS ----------
        te = tufe_endeksi(m)
        altyapi_usd = parcali(V["altyapi_usd_egri"], aktif, V["altyapi_usd_marjinal"])
        c_altyapi = altyapi_usd * kr
        c_llm = (aktif_pro_sube * V["llm_usd_isletme"] * kr
                 if V["llm_baslangic_ay"] and m >= V["llm_baslangic_ay"] else 0.0)
        c_sms = sms_adet * V["sms_birim_tl"] * te
        c_waba = aktif * V["waba_usd_isletme"] * kr
        kartli = aylik_tahsil * V["kart_payi_aylik"] + yillik_tahsil * V["kart_payi_yillik"] + kurulum_geliri
        c_psp = kartli * V["psp_oran"]
        c_efatura = V["efatura_aylik"] * te if m >= V["efatura_baslangic_ay"] else 0.0
        cogs = c_altyapi + c_llm + c_sms + c_waba + c_psp + c_efatura + p_destek

        # ---------- 3.6 Opex (personel dışı) ----------
        cac = V["cac_carpani"]
        sp_diger = (basili
                    + yeni_org * V["organik_reklam_cac"] * te
                    + bayi_komisyonu
                    + (V["etkinlik_aylik"] * te if m > V["lansman_ay"] else 0)
                    + (V["ikinci_sehir_acilis"] * te if V["ikinci_sehir_ay"] == m else 0)
                    + (V["d5_reklam"] / 2 if m in (1, 2) else 0)
                    + (V["d3_basili"] if m == 2 else 0)
                    + (V["kurucu_saha_yol"] * te if m <= V["kurucu_saha_yol_bitis"] else 0))
        opex_satis = (p_satis + sp_diger) * cac

        gy = V["mali_musavir"] * te + kisi * V["arac_usd_kisi"] * kr
        if m in V["hukuk_uyum_aylari"]:
            gy += V["hukuk_uyum_paketi"] / len(V["hukuk_uyum_aylari"])
        if lansman:
            gy += V["hukuk_surekli"] * te
        if m == 1:
            gy += V["sirket_kurulus"] + V["marka_tescil"] + V["tasarim"]
        if V["pentest_ay"] and (m - V["pentest_ay"]) >= 0 and (m - V["pentest_ay"]) % 12 == 0:
            gy += V["pentest"] * te
        if m == V["pilot_ay"]:
            gy += V["pilot_tablet"]
        if tekno:
            gy += V["teknokent_kira"] * te
        beklenmeyen = V["beklenmeyen_orani"] * (gy + sp_diger * cac)
        opex = p_kurucu + p_arge + opex_satis + gy + beklenmeyen

        # ---------- 3.7 Sonuç ----------
        brut = toplam_gelir - cogs
        ebitda = brut - opex
        net_nakit = nakit_giris - cogs - opex
        kum_nakit += net_nakit
        doviz = (altyapi_usd * V["altyapi_yurtdisi_payi"] * kr + c_llm + c_waba
                 + kisi * V["arac_usd_kisi"] * kr)

        r.update({
            "aktif_isletme": aktif, "odeyen_isletme": odeyen, "yeni_isletme": yeni,
            "churn_isletme": churn_adet,
            "esnaf": paket_adet["esnaf"], "pro": paket_adet["pro"], "zincir": paket_adet["zincir"],
            "mrr": mrr, "arpu": mrr / odeyen if odeyen else 0.0,
            "abonelik_geliri": abonelik_geliri, "kurulum_geliri": kurulum_geliri,
            "referans_indirimi": ref_indirimi, "toplam_gelir": toplam_gelir,
            "cogs_altyapi": c_altyapi, "cogs_llm": c_llm, "cogs_sms": c_sms, "cogs_waba": c_waba,
            "cogs_psp": c_psp, "cogs_efatura": c_efatura, "cogs_destek_personel": p_destek,
            "cogs_toplam": cogs, "brut_kar": brut,
            "brut_marj": brut / toplam_gelir if toplam_gelir > 0 else None,
            "opex_kurucular": p_kurucu, "opex_arge_personel": p_arge,
            "opex_satis_pazarlama": opex_satis, "opex_bayi_komisyonu": bayi_komisyonu * cac,
            "opex_genel_yonetim": gy, "opex_beklenmeyen": beklenmeyen, "opex_toplam": opex,
            "ebitda": ebitda, "yillik_pesin_nakit_farki": yillik_tahsil - yillik_taninan,
            "net_nakit_akisi": net_nakit, "kumulatif_nakit": kum_nakit,
            "doviz_gider": doviz,
            "doviz_gider_orani": doviz / abonelik_geliri if abonelik_geliri > 0 else None,
            "kisi_sayisi": kisi, "gelistirici": n_dev, "destek": n_destek, "saha": n_saha,
            "kur": kr, "satis_pazarlama_cac_bazi": opex_satis + ref_indirimi,
            "satis_pazarlama_reel": (opex_satis + ref_indirimi) / te,
        })
        satirlar.append(r)
    return satirlar


# =============================================================================
# 4) Türetilen göstergeler
# =============================================================================
def sermaye_ihtiyaci(satirlar, V):
    """Her ay: kasa ≥ %20 × o güne kadarki açık + 9 × (son 3 ayın ort. net nakit çıkışı).
    Gerekli sermaye = max_m [ (1+tampon) × açık(m) + pist × yakım3(m) ]."""
    en_iyi, baglayan, en_buyuk_acik, dip_ay = 0.0, None, 0.0, None
    for i, r in enumerate(satirlar):
        acik = max(0.0, -r["kumulatif_nakit"])
        if acik > en_buyuk_acik:
            en_buyuk_acik, dip_ay = acik, i + 1
        pencere = [x["net_nakit_akisi"] for x in satirlar[max(0, i - 2):i + 1]]
        yakim = max(0.0, -sum(pencere) / len(pencere))
        gerek = (1 + V["tampon"]) * acik + V["pist_ay"] * yakim
        if gerek > en_iyi:
            en_iyi, baglayan = gerek, i + 1
    return {"gerekli": en_iyi, "baglayan_ay": baglayan, "en_buyuk_acik": en_buyuk_acik,
            "dip_ay": dip_ay, "acik_arti_tampon": (1 + V["tampon"]) * en_buyuk_acik}


def basa_bas(satirlar):
    """Kalıcı başa baş: bu aydan sonra EBITDA hiç negatife dönmüyor."""
    ilk = next((r["ay_no"] for r in satirlar if r["ebitda"] >= 0), None)
    kalici = None
    for r in reversed(satirlar):
        if r["ebitda"] >= 0:
            kalici = r["ay_no"]
        else:
            break
    return ilk, kalici


def pist_serisi(satirlar, sermaye):
    sonuc = []
    for i, r in enumerate(satirlar):
        kasa = sermaye + r["kumulatif_nakit"]
        pencere = [x["net_nakit_akisi"] for x in satirlar[max(0, i - 2):i + 1]]
        yakim = -sum(pencere) / len(pencere)
        sonuc.append((kasa, (kasa / yakim) if yakim > 0 else None))
    return sonuc


UZATMA_AY = 36   # başa baş ayı için uzatılmış projeksiyon (Ay 25–36: son büyüme hızı, aynı kurallar)


def uzat(V, ay):
    U = copy.deepcopy(V)
    U["ay_sayisi"] = ay
    U["ocak_aylari"] = list(range(4, ay + 1, 12))
    g = sorted(U["fiyat_guncelleme_aylari"])
    if g:
        while g[-1] + U["fiyat_guncelleme_periyot"] <= ay:
            g.append(g[-1] + U["fiyat_guncelleme_periyot"])
    U["fiyat_guncelleme_aylari"] = g
    return U


def calistir(degisiklik=None, senaryo="go"):
    V = birlestir(VARSAYIMLAR, SENARYOLAR[senaryo])
    if degisiklik:
        V = birlestir(V, degisiklik)
    satirlar = simule_et(V)
    s = sermaye_ihtiyaci(satirlar, V)
    uzun = simule_et(uzat(V, UZATMA_AY))
    ilk, kalici = basa_bas(uzun)
    dip36 = min(uzun, key=lambda r: r["kumulatif_nakit"])
    s.update({"basa_bas_ilk": ilk, "basa_bas_kalici": kalici, "V": V, "satirlar": satirlar,
              "uzun": uzun, "dip36": dip36["kumulatif_nakit"], "dip36_ay": dip36["ay_no"],
              "m24_aktif": satirlar[-1]["aktif_isletme"], "m24_mrr": satirlar[-1]["mrr"]})
    return s


def ay_kisa(m):
    return "yok" if m is None else f"Ay {m}"


def ay_yaz(m):
    return f"{UZATMA_AY} ayda yok" if m is None else f"Ay {m} ({ay_etiketi(m)})"


# =============================================================================
# 5) Birim ekonomi (bugünün fiyatlarıyla, enflasyonsuz)
# =============================================================================
def birim_ekonomi(V, olcek, destek_orani, faz2=True):
    kur = V["kur_usd_try"]
    altyapi = parcali(V["altyapi_usd_egri"], olcek, V["altyapi_usd_marjinal"]) / olcek * kur
    efatura = V["efatura_aylik"] / olcek
    waba = V["waba_usd_isletme"] * kur
    sonuc = {}
    for p in PAKETLER:
        sube = V["zincir_ort_sube"] if p == "zincir" else 1
        fiyat = V["liste_fiyat"][p] * sube * V["fiyat_carpani"]
        llm = (V["llm_usd_isletme"] * kur * sube) if (faz2 and p != "esnaf") else 0.0
        sms = V["sms_kota"][p] * sube * V["sms_kota_kullanim"] * V["sms_birim_tl"]
        agirlik = V["esnaf_destek_agirligi"] if p == "esnaf" else sube
        destek = V["destek_maas"] / destek_orani * agirlik
        sabit = altyapi + efatura + waba + llm + sms + destek
        satir = {"fiyat": fiyat, "altyapi": altyapi, "llm": llm, "sms": sms, "destek": destek}
        for ad, arpu, kart in (("liste", fiyat, V["kart_payi_aylik"]),
                               ("kurucu", fiyat * (1 - V["kurucu_uye_indirim"]), V["kart_payi_aylik"]),
                               ("yillik", fiyat * (1 - V["yillik_indirim"]), V["kart_payi_yillik"])):
            cogs = sabit + arpu * kart * V["psp_oran"]
            satir[ad] = {"arpu": arpu, "cogs": cogs, "marj": (arpu - cogs) / arpu}
        sonuc[p] = satir
    return sonuc


def ima_edilen_cac(satirlar, V):
    """Satış-pazarlama gideri (referans indirimi dahil) / yeni ödeyen işletme, lansmandan itibaren.
    (nominal, 2026 TL'si ile reel) döner."""
    sec = [r for r in satirlar if r["ay_no"] >= V["lansman_ay"]]
    yeni = sum(r["yeni_isletme"] for r in sec)
    if not yeni:
        return None, None
    return (sum(r["satis_pazarlama_cac_bazi"] for r in sec) / yeni,
            sum(r["satis_pazarlama_reel"] for r in sec) / yeni)


# =============================================================================
# 6) Çıktılar
# =============================================================================
CSV_ALANLARI = ["ay_no", "ay", "aktif_isletme", "odeyen_isletme", "yeni_isletme", "churn_isletme",
                "esnaf", "pro", "zincir", "mrr", "arpu", "abonelik_geliri", "kurulum_geliri",
                "referans_indirimi", "toplam_gelir", "cogs_altyapi", "cogs_llm", "cogs_sms", "cogs_waba",
                "cogs_psp", "cogs_efatura", "cogs_destek_personel", "cogs_toplam", "brut_kar", "brut_marj",
                "opex_kurucular", "opex_arge_personel", "opex_satis_pazarlama", "opex_bayi_komisyonu",
                "opex_genel_yonetim", "opex_beklenmeyen", "opex_toplam", "ebitda",
                "yillik_pesin_nakit_farki", "net_nakit_akisi", "kumulatif_nakit", "nakit_bakiyesi",
                "pist_ay", "doviz_gider", "doviz_gider_orani", "kisi_sayisi", "gelistirici", "destek",
                "saha", "kur"]


def csv_yaz(yol, satirlar, sermaye):
    pist = pist_serisi(satirlar, sermaye)
    with open(yol, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_ALANLARI)
        for r, (kasa, p) in zip(satirlar, pist):
            r = dict(r, nakit_bakiyesi=kasa, pist_ay=p)
            satir = []
            for a in CSV_ALANLARI:
                v = r.get(a)
                if v is None:
                    satir.append("")
                elif isinstance(v, float):
                    satir.append(f"{v:.4f}" if a in ("brut_marj", "doviz_gider_orani", "pist_ay") else f"{v:.0f}"
                                 if a not in ("aktif_isletme", "odeyen_isletme", "yeni_isletme", "churn_isletme",
                                              "esnaf", "pro", "zincir", "kisi_sayisi", "kur") else f"{v:.1f}")
                else:
                    satir.append(v)
            w.writerow(satir)


def ceyreklik_tablo(satirlar):
    satir_listesi = []
    for q in range(0, len(satirlar), 3):
        g = satirlar[q:q + 3]
        son = g[-1]
        gelir = sum(x["toplam_gelir"] for x in g)
        cogs = sum(x["cogs_toplam"] for x in g)
        opex = sum(x["opex_toplam"] for x in g)
        brut = gelir - cogs
        marj = f" ({yuzde(brut / gelir)})" if gelir > 0 and brut / gelir >= -1 else ""   # −%100 altı gösterilmez
        satir_listesi.append(
            f"| {ceyrek_etiketi(g[0]['ay_no'])} | {tr(son['aktif_isletme'])} ({tr(son['odeyen_isletme'])}) "
            f"| {tr(son['mrr'] / 1e3)} | {tr(gelir / 1e3)} | {tr(cogs / 1e3)} | {tr(brut / 1e3)}{marj} "
            f"| {tr(opex / 1e3)} | {tr((brut - opex) / 1e3)} | {tr(son['kumulatif_nakit'] / 1e3)} |")
    bas = ("| Çeyrek | Dönem sonu aktif (ödeyen) | Dönem sonu MRR | Gelir | COGS | Brüt kâr (marj) "
           "| Opex | EBITDA | Kümülatif nakit (dönem sonu) |\n|---|---|---|---|---|---|---|---|---|")
    return bas + "\n" + "\n".join(satir_listesi)


def main():
    sessiz = "--sessiz" in sys.argv
    klasor = os.path.dirname(os.path.abspath(__file__))
    out = []

    def yaz(s=""):
        out.append(s)

    sonuclar = {s: calistir(senaryo=s) for s in SENARYO_SIRASI}
    for s, sn in sonuclar.items():
        csv_yaz(os.path.join(klasor, f"senaryo-{s}.csv"), sn["satirlar"], sn["gerekli"])

    # --- Senaryo özeti ---
    yaz("### Senaryo özeti")
    yaz("| Senaryo | En düşük kümülatif nakit, Ay 1–24 (ay) | Açık + %20 tampon | Gerekli başlangıç sermayesi "
        "(tampon + 9 ay pist) | Bağlayan ay | İlk EBITDA ≥ 0 | Kalıcı başa baş (EBITDA ≥ 0) "
        "| En düşük kümülatif nakit, 36 aylık uzatma | Ay 24 aktif işletme | Ay 24 MRR | Ay 24 ARR |")
    yaz("|---|---|---|---|---|---|---|---|---|---|---|")
    usd = []
    for s in SENARYO_SIRASI:
        sn = sonuclar[s]
        yaz(f"| {SENARYOLAR[s]['ad']} | −{mn(sn['en_buyuk_acik'])} ({ay_etiketi(sn['dip_ay'])}) "
            f"| {mn(sn['acik_arti_tampon'])} | **{mn(sn['gerekli'])}** | {ay_etiketi(sn['baglayan_ay'])} "
            f"| {ay_yaz(sn['basa_bas_ilk'])} | **{ay_yaz(sn['basa_bas_kalici'])}** "
            f"| {mn(sn['dip36'])} ({ay_etiketi(sn['dip36_ay'])}) | {tr(sn['m24_aktif'])} "
            f"| {tr(sn['m24_mrr'] / 1e3)} bin TL | {mn(sn['m24_mrr'] * 12)} |")
        usd.append(f"{SENARYOLAR[s]['ad']} ≈ {tr(sn['gerekli'] / VARSAYIMLAR['kur_usd_try'] / 1e3)} bin USD")
    yaz()
    yaz("Gerekli sermayenin 48,4 kurla USD karşılığı: " + "; ".join(usd) + ".")
    # Durdur kolu
    no = sonuclar["nogo"]
    V = no["V"]
    m3 = no["satirlar"][2]
    kapanis = (V["kurucu_sayisi"] * V["kurucu_maas"] + V["G_gelistirici"] * V["M_gelistirici_maas"]) + 50000
    yaz()
    yaz(f"Durdur kolu (NO-GO + pivot desteklenmiyor, Ay 3 sonunda kapanış): Ay 1–3 kümülatif nakit "
        f"{mn(m3['kumulatif_nakit'])} + kapanış gideri ≈ {mn(kapanis)} (1 ay ihbar/maaş + 50.000 TL tasfiye [T]) "
        f"→ toplam ≈ {mn(-m3['kumulatif_nakit'] + kapanis)}.")
    m8 = no["satirlar"][7]
    kap8 = (V["kurucu_sayisi"] * V["kurucu_maas"] + V["G_gelistirici"] * V["M_gelistirici_maas"]) \
        * (1 + V["maas_artisi_ocak"]) + 50000
    yaz()
    yaz(f"Pivot doğrulama dilimi (NO-GO sonrası pivot pilotunun sonucuna, Ay 8 = {ay_etiketi(8)} sonuna kadar): "
        f"kümülatif nakit {mn(m8['kumulatif_nakit'])}; %20 tampon + kapanış gideriyle ≈ "
        f"{mn(-m8['kumulatif_nakit'] * (1 + V['tampon']) + kap8)}.")

    # --- Çeyreklik tablolar ---
    for s in reversed(SENARYO_SIRASI):
        yaz()
        yaz(f"### Çeyreklik özet — {SENARYOLAR[s]['ad']} (bin TL)")
        yaz(ceyreklik_tablo(sonuclar[s]["satirlar"]))

    # --- Koruyucu metrikler ---
    yaz()
    yaz("### Koruyucu metrikler (gerekli sermaye alındığında)")
    yaz("| Senaryo | Döviz gider / gelir: Ay 8 | Ay 12 | Ay 18 | Ay 24 | En düşük nakit pisti (Ay 1–24) | Ay 24 kasa |")
    yaz("|---|---|---|---|---|---|---|")
    for s in SENARYO_SIRASI:
        sn = sonuclar[s]
        st = sn["satirlar"]
        pist = pist_serisi(st, sn["gerekli"])
        pistler = [p for _, p in pist if p is not None]
        yaz(f"| {SENARYOLAR[s]['ad']} | {yuzde(st[7]['doviz_gider_orani'])} | {yuzde(st[11]['doviz_gider_orani'])} "
            f"| {yuzde(st[17]['doviz_gider_orani'])} | {yuzde(st[23]['doviz_gider_orani'])} "
            f"| {tr(min(pistler), 1) + ' ay' if pistler else '—'} | {mn(pist[-1][0])} |")

    # --- Duyarlılık ---
    duyarlilik = [
        ("Baz", {}),
        ("Churn +2 puan", {"churn_delta": 0.02}), ("Churn −2 puan", {"churn_delta": -0.02}),
        ("CAC +%30", {"cac_carpani": 1.3}), ("CAC −%30", {"cac_carpani": 0.7}),
        ("Kur +%20 (döviz bazlı maliyetler)", {"kur_carpani": 1.2}), ("Kur −%20", {"kur_carpani": 0.8}),
        ("Fiyat +%15", {"fiyat_carpani": 1.15}), ("Fiyat −%15", {"fiyat_carpani": 0.85}),
        ("Yeni işletme hızı +%30", {"yeni_isletme_carpani": 1.3}),
        ("Yeni işletme hızı −%30", {"yeni_isletme_carpani": 0.7}),
    ]
    ozet_csv = []
    yaz()
    yaz("### Duyarlılık")
    yaz("| Değişken | GO: en büyük açık | GO: gerekli sermaye | GO: başa baş ilk / kalıcı "
        "| KOŞULLU: en büyük açık | KOŞULLU: gerekli sermaye | KOŞULLU: başa baş ilk / kalıcı |")
    yaz("|---|---|---|---|---|---|---|")

    def ik(x):
        return f"{ay_kisa(x['basa_bas_ilk'])} / {ay_kisa(x['basa_bas_kalici'])}"
    for ad, d in duyarlilik:
        g, k = calistir(d, "go"), calistir(d, "kosullu")
        yaz(f"| {ad} | {mn(g['en_buyuk_acik'])} | {mn(g['gerekli'])} | {ik(g)} | {mn(k['en_buyuk_acik'])} "
            f"| {mn(k['gerekli'])} | {ik(k)} |")
        ozet_csv.append(["duyarlilik", ad, "go", round(g["gerekli"]), g["basa_bas_kalici"] or ""])
        ozet_csv.append(["duyarlilik", ad, "kosullu", round(k["gerekli"]), k["basa_bas_kalici"] or ""])

    # --- Birim ekonomi ---
    Vg = sonuclar["go"]["V"]
    yaz()
    yaz("### Birim ekonomi (bugünün fiyatlarıyla; Faz 2, AI dahil)")
    yaz("| Paket | Ölçek | ARPU liste / kurucu üye / yıllık (TL/ay) | COGS (liste) | Brüt marj liste / kurucu / yıllık |")
    yaz("|---|---|---|---|---|")
    for olcek, oran in ((100, Vg["destek_oran_ilk"]), (1000, Vg["destek_oran_sonra"])):
        be = birim_ekonomi(Vg, olcek, oran)
        for p in PAKETLER:
            b = be[p]
            yaz(f"| {p.capitalize()}{' (3 şube)' if p == 'zincir' else ''} | {olcek} işletme "
                f"| {tr(b['liste']['arpu'])} / {tr(b['kurucu']['arpu'])} / {tr(b['yillik']['arpu'])} "
                f"| {tr(b['liste']['cogs'])} (altyapı {tr(b['altyapi'])}, destek {tr(b['destek'])}, "
                f"LLM {tr(b['llm'])}, SMS {tr(b['sms'])}) "
                f"| {yuzde(b['liste']['marj'])} / {yuzde(b['kurucu']['marj'])} / {yuzde(b['yillik']['marj'])} |")
    cac_g_nom, cac_g = ima_edilen_cac(sonuclar["go"]["satirlar"], Vg)
    cac_k_nom, cac_k = ima_edilen_cac(sonuclar["kosullu"]["satirlar"], sonuclar["kosullu"]["V"])
    yaz()
    yaz(f"Modelin ima ettiği karma CAC (lansmandan Ay 24'e; satış-pazarlama + referans indirimi / yeni ödeyen): "
        f"GO {tr(cac_g_nom)} TL nominal = {tr(cac_g)} TL (2026 fiyatlarıyla); "
        f"KOŞULLU {tr(cac_k_nom)} TL nominal = {tr(cac_k)} TL (2026 fiyatlarıyla).")
    yaz()
    yaz("| Paket (1.000 işletme ölçeği, liste fiyatı) | CAC | Aylık brüt kâr | Geri ödeme | LTV (churn %5) "
        "| LTV/CAC | LTV (churn %2,5) | LTV/CAC |")
    yaz("|---|---|---|---|---|---|---|---|")
    be = birim_ekonomi(Vg, 1000, Vg["destek_oran_sonra"])
    for p, cac in (("esnaf", 2800), ("pro", 4000), ("zincir", 4000), ("pro", cac_g)):
        b = be[p]["liste"]
        kar = b["arpu"] - b["cogs"]
        etiket = p.capitalize() + (" (GO model CAC'ı, 2026 TL)" if cac == cac_g else "")
        yaz(f"| {etiket} | {tr(cac)} | {tr(kar)} | {tr(cac / kar, 1)} ay | {tr(kar / 0.05)} | {tr(kar / 0.05 / cac, 1)}× "
            f"| {tr(kar / 0.025)} | {tr(kar / 0.025 / cac, 1)}× |")

    yaz()
    yaz(f"{VARSAYIMLAR['hedef_geri_odeme_ay']} aylık geri ödeme için CAC tavanı (1.000 işletme ölçeği, modelin brüt "
        f"marjıyla): " + "; ".join(
            f"{p.capitalize()} liste {tr((be[p]['liste']['arpu'] - be[p]['liste']['cogs']) * VARSAYIMLAR['hedef_geri_odeme_ay'])} TL, "
            f"kurucu üye {tr((be[p]['kurucu']['arpu'] - be[p]['kurucu']['cogs']) * VARSAYIMLAR['hedef_geri_odeme_ay'])} TL"
            for p in PAKETLER) + ".")

    # --- Esnaf seçenekleri ---
    secenekler = [
        ("Baz: düşük marjı kabul (giriş paketi)", {}),
        ("A: Esnaf fiyatı 1.190 TL (+%20), Esnaf talebi −%10 [T]",
         {"liste_fiyat": {"esnaf": 1190, "pro": 1790, "zincir": 2990}, "esnaf_talep_carpani": 0.9}),
        ("B: Esnaf SMS kotası 100 → 50", {"sms_kota": {"esnaf": 50, "pro": 300, "zincir": 300}}),
        ("B+: B + Esnaf self-servis destek (destek yükü ×0,5) [T]",
         {"sms_kota": {"esnaf": 50, "pro": 300, "zincir": 300}, "esnaf_destek_agirligi": 0.5}),
        ("C: Esnaf yalnız yıllık peşin (9.504 TL), Esnaf talebi −%25 [T]",
         {"esnaf_yalniz_yillik": True, "esnaf_talep_carpani": 0.75}),
    ]
    yaz()
    yaz("### Esnaf paketi seçenekleri (00 §13.11) — GO senaryosu")
    yaz("| Seçenek | Esnaf brüt marjı (1.000 işl.; liste/yıllık) | Esnaf brüt marjı (100 işl.) | GO gerekli sermaye "
        "| Kalıcı başa baş | Ay 24 MRR | Ay 24 aktif |")
    yaz("|---|---|---|---|---|---|---|")
    for ad, d in secenekler:
        g = calistir(d, "go")
        V2 = g["V"]
        b1 = birim_ekonomi(V2, 1000, V2["destek_oran_sonra"])["esnaf"]
        b2 = birim_ekonomi(V2, 100, V2["destek_oran_ilk"])["esnaf"]
        ana = b1["yillik"]["marj"] if V2["esnaf_yalniz_yillik"] else b1["liste"]["marj"]
        ana100 = b2["yillik"]["marj"] if V2["esnaf_yalniz_yillik"] else b2["liste"]["marj"]
        yaz(f"| {ad} | {yuzde(ana)} | {yuzde(ana100)} | {mn(g['gerekli'])} | {ay_yaz(g['basa_bas_kalici'])} "
            f"| {tr(g['m24_mrr'] / 1e3)} bin TL | {tr(g['m24_aktif'])} |")
        ozet_csv.append(["esnaf_secenegi", ad, "go", round(g["gerekli"]), g["basa_bas_kalici"] or ""])

    # --- Politika varyantları ---
    varyantlar = [
        ("Baz: TÜFE güncellemesi yılda 1 (Ocak 2028)", {}),
        ("Yılda 2 güncelleme (Tem 2027, Oca 2028, Tem 2028)",
         {"fiyat_guncelleme_aylari": [10, 16, 22], "fiyat_guncelleme_periyot": 6}),
        ("Lansman öncesi güncelleme (Oca 2027) + Oca 2028", {"fiyat_guncelleme_aylari": [4, 16]}),
        ("Hiç güncelleme yok", {"fiyat_guncelleme_aylari": []}),
        ("Teknokent (Oca 2027'den; Ar-Ge personeli −%20 [T], kira +20 bin TL/ay [T])", {"teknokent_ay": 4}),
        ("Önlem paketi: lansman öncesi güncelleme + Teknokent + Esnaf self-servis (B+)",
         {"fiyat_guncelleme_aylari": [4, 16], "teknokent_ay": 4, "esnaf_destek_agirligi": 0.5,
          "sms_kota": {"esnaf": 50, "pro": 300, "zincir": 300}}),
    ]
    yaz()
    yaz("### Fiyat politikası ve Teknokent varyantları")
    yaz("| Varyant | GO: gerekli sermaye | GO: başa baş ilk / kalıcı | KOŞULLU: gerekli sermaye "
        "| KOŞULLU: başa baş ilk / kalıcı | KOŞULLU: Ay 36 EBITDA/ay |")
    yaz("|---|---|---|---|---|---|")
    for ad, d in varyantlar:
        g, k = calistir(d, "go"), calistir(d, "kosullu")
        yaz(f"| {ad} | {mn(g['gerekli'])} | {ik(g)} | {mn(k['gerekli'])} | {ik(k)} "
            f"| {mn(k['uzun'][-1]['ebitda'])} |")
        ozet_csv.append(["varyant", ad, "go", round(g["gerekli"]), g["basa_bas_kalici"] or ""])
        ozet_csv.append(["varyant", ad, "kosullu", round(k["gerekli"]), k["basa_bas_kalici"] or ""])

    # --- Kilometre taşı bazında sermaye ---
    yaz()
    yaz("### Kilometre taşlarında kümülatif nakit ve o tarihe kadar gereken sermaye (tampon + 9 ay pist kuralıyla)")
    yaz("| Kilometre taşı | Ay | GO: kümülatif nakit | GO: gereken sermaye (o tarihe kadar) "
        "| KOŞULLU: kümülatif nakit | KOŞULLU: gereken sermaye |")
    yaz("|---|---|---|---|---|---|")
    for m, ad in VARSAYIMLAR["kilometre_taslari"].items():
        hucreler = []
        for s in ("go", "kosullu"):
            st = sonuclar[s]["satirlar"][:m]
            hucreler += [mn(st[-1]["kumulatif_nakit"]), mn(sermaye_ihtiyaci(st, sonuclar[s]["V"])["gerekli"])]
        yaz(f"| {ad} | Ay {m} ({ay_etiketi(m)}) | " + " | ".join(hucreler) + " |")

    # --- Hisse örneği ---
    yaz()
    yaz("### Hisse yapısı örneği [T]")
    yaz(f"| Pay sahibi | Kuruluş | Pre-seed sonrası (örnek %{tr(100 * VARSAYIMLAR['pre_seed_seyrelme'])} seyrelme) |")
    yaz("|---|---|---|")
    ss = VARSAYIMLAR["pre_seed_seyrelme"]
    for ad, pay in VARSAYIMLAR["hisse_kurulus"].items():
        yaz(f"| {ad} | {yuzde(pay, 1)} | {yuzde(pay * (1 - ss), 2)} |")
    yaz(f"| Pre-seed yatırımcı(lar)ı | — | {yuzde(ss, 1)} |")
    yaz("| **Toplam** | %100 | %100 |")

    # --- Fon kullanımı ---
    for s in ("go", "kosullu"):
        sn = sonuclar[s]
        st = sn["satirlar"][:sn["dip_ay"]]
        kalemler = [
            ("Ürün geliştirme (geliştiriciler, SRE)", sum(r["opex_arge_personel"] for r in st)),
            ("Kurucu maaşları", sum(r["opex_kurucular"] for r in st)),
            ("Satış ve pazarlama (saha, basılı, reklam, bayi, etkinlik)", sum(r["opex_satis_pazarlama"] for r in st)),
            ("Destek ve onboarding personeli", sum(r["cogs_destek_personel"] for r in st)),
            ("Altyapı, LLM, SMS, PSP, e-fatura", sum(r["cogs_toplam"] - r["cogs_destek_personel"] for r in st)),
            ("Hukuk, muhasebe, pentest, araçlar, kuruluş, beklenmeyen",
             sum(r["opex_genel_yonetim"] + r["opex_beklenmeyen"] for r in st)),
        ]
        gider = sum(v for _, v in kalemler)
        gelir_nakit = gider - sn["en_buyuk_acik"]
        yaz()
        yaz(f"### Fon kullanımı — {SENARYOLAR[s]['ad']} (Ay 1 → nakit dibi {ay_etiketi(sn['dip_ay'])})")
        yaz("| Kalem | Tutar | Pay |")
        yaz("|---|---|---|")
        for ad, v in kalemler:
            yaz(f"| {ad} | {mn(v)} | {yuzde(v / gider)} |")
        yaz(f"| **Toplam nakit gider** | **{mn(gider)}** | %100 |")
        yaz(f"| Eksi: aynı dönemde tahsilat | −{mn(gelir_nakit)} | |")
        yaz(f"| **= En büyük açık** | **{mn(sn['en_buyuk_acik'])}** | |")
        yaz(f"| Artı: %20 tampon ve 9 ay pist koşulu | {mn(sn['gerekli'] - sn['en_buyuk_acik'])} | |")
        yaz(f"| **= Gerekli sermaye** | **{mn(sn['gerekli'])}** | |")

    # --- Varsayım kontrol noktaları ---
    yaz()
    yaz("### Kontrol noktaları")
    for s in SENARYO_SIRASI:
        st = sonuclar[s]["satirlar"]
        yaz(f"- {SENARYOLAR[s]['ad']}: aktif işletme Ay 9 = {tr(st[8]['aktif_isletme'])}, Ay 18 = "
            f"{tr(st[17]['aktif_isletme'])}, Ay 24 = {tr(st[23]['aktif_isletme'])}; kişi sayısı Ay 24 = "
            f"{tr(st[23]['kisi_sayisi'], 1)}; ARPU Ay 24 = {tr(st[23]['arpu'])} TL; aylık gider Ay 24 = "
            f"{mn(st[23]['cogs_toplam'] + st[23]['opex_toplam'])}; brüt marj Ay 24 = {yuzde(st[23]['brut_marj'])}; "
            f"Ay 36 (uzatma) aktif = {tr(sonuclar[s]['uzun'][-1]['aktif_isletme'])}, EBITDA = "
            f"{mn(sonuclar[s]['uzun'][-1]['ebitda'])}/ay")

    with open(os.path.join(klasor, "senaryo-ozet.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tur", "ad", "senaryo", "gerekli_sermaye_tl", "kalici_basa_bas_ay_no"])
        for s in SENARYO_SIRASI:
            sn = sonuclar[s]
            w.writerow(["senaryo", SENARYOLAR[s]["ad"], s, round(sn["gerekli"]), sn["basa_bas_kalici"] or ""])
        w.writerows(ozet_csv)

    if not sessiz:
        print("\n".join(out))


if __name__ == "__main__":
    main()
