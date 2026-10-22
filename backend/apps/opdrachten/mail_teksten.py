"""Vertalingen voor de opdrachtmails.

De mails gaan naar externe ontvangers, niet naar ingelogde gebruikers, dus de
taal komt uit de mailinstelling van de opdrachtgever en niet uit een verzoek.
"""

TALEN = (
    ('nl', 'Nederlands'),
    ('en', 'English'),
    ('tr', 'Türkçe'),
)

TEKSTEN = {
    'nl': {
        'kop_gestart': 'Opdracht gestart',
        'kop_afgeleverd': 'Opdracht afgerond',
        'kop_niet_geleverd': 'Opdracht niet geleverd',
        'titel_gestart': 'Onderweg naar %(klant)s',
        'titel_afgeleverd': 'Afgeleverd bij %(klant)s',
        'titel_niet_geleverd': 'Niet geleverd bij %(klant)s',
        'koptekst_gestart': '%(chauffeur)s is onderweg',
        'inleiding_gestart': 'De chauffeur heeft de opdracht aangenomen en rijdt nu naar %(klant)s.',
        'inleiding_afgeleverd': 'De opdracht is afgerond. Hieronder vindt u de gegevens van de aflevering.',
        'inleiding_niet_geleverd': 'De chauffeur heeft deze opdracht niet kunnen afleveren. Hieronder vindt u de gegevens en de opgegeven reden.',
        'ritnummer': 'Ritnummer',
        'chauffeur': 'Chauffeur',
        'kenteken': 'Kenteken',
        'klant': 'Klant',
        'adres': 'Adres',
        'gestart_om': 'Gestart om',
        'afgeleverd_op': 'Afgeleverd op',
        'gemeld_op': 'Gemeld op',
        'geopend_tot': 'Geopend tot',
        'reden': 'Reden',
        'opmerking': 'Opmerking van de chauffeur',
        'bijlagen': 'Bijlagen in deze mail:',
        'voettekst': 'Deze melding is automatisch verstuurd door het Moveo transportsysteem. Reageren op dit bericht is niet nodig.',
    },
    'en': {
        'kop_gestart': 'Order started',
        'kop_afgeleverd': 'Order completed',
        'kop_niet_geleverd': 'Order not delivered',
        'titel_gestart': 'On the way to %(klant)s',
        'titel_afgeleverd': 'Delivered at %(klant)s',
        'titel_niet_geleverd': 'Not delivered at %(klant)s',
        'koptekst_gestart': '%(chauffeur)s is on the way',
        'inleiding_gestart': 'The driver has accepted the order and is now driving to %(klant)s.',
        'inleiding_afgeleverd': 'The order has been completed. Below are the delivery details.',
        'inleiding_niet_geleverd': 'The driver was unable to deliver this order. Below are the details and the reason given.',
        'ritnummer': 'Trip number',
        'chauffeur': 'Driver',
        'kenteken': 'Licence plate',
        'klant': 'Customer',
        'adres': 'Address',
        'gestart_om': 'Started at',
        'afgeleverd_op': 'Delivered at',
        'gemeld_op': 'Reported at',
        'geopend_tot': 'Open until',
        'reden': 'Reason',
        'opmerking': 'Note from the driver',
        'bijlagen': 'Attachments in this email:',
        'voettekst': 'This message was sent automatically by the Moveo transport system. No reply is needed.',
    },
    'tr': {
        'kop_gestart': 'Sipariş başlatıldı',
        'kop_afgeleverd': 'Sipariş tamamlandı',
        'kop_niet_geleverd': 'Sipariş teslim edilemedi',
        'titel_gestart': '%(klant)s adresine yolda',
        'titel_afgeleverd': '%(klant)s adresine teslim edildi',
        'titel_niet_geleverd': '%(klant)s adresine teslim edilemedi',
        'koptekst_gestart': '%(chauffeur)s yolda',
        'inleiding_gestart': 'Şoför siparişi kabul etti ve şimdi %(klant)s adresine gidiyor.',
        'inleiding_afgeleverd': 'Sipariş tamamlandı. Teslimat bilgileri aşağıdadır.',
        'inleiding_niet_geleverd': 'Şoför bu siparişi teslim edemedi. Bilgiler ve belirtilen neden aşağıdadır.',
        'ritnummer': 'Sefer numarası',
        'chauffeur': 'Şoför',
        'kenteken': 'Plaka',
        'klant': 'Müşteri',
        'adres': 'Adres',
        'gestart_om': 'Başlangıç saati',
        'afgeleverd_op': 'Teslim tarihi',
        'gemeld_op': 'Bildirim tarihi',
        'geopend_tot': 'Açık olduğu saat',
        'reden': 'Neden',
        'opmerking': 'Şoförün notu',
        'bijlagen': 'Bu e-postadaki ekler:',
        'voettekst': 'Bu bildirim Moveo taşıma sistemi tarafından otomatik olarak gönderilmiştir. Yanıt vermenize gerek yoktur.',
    },
}


def teksten_voor(taal):
    return TEKSTEN.get(taal or 'nl', TEKSTEN['nl'])
