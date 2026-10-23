"""Teksten voor de betalingsherinnering, per taal.

De taal volgt de mailinstelling van het bedrijf; ontbreekt die, dan Nederlands.
De nummers staan voor de hoeveelste herinnering, niet voor een aantal dagen:
het interval is per opdrachtgever instelbaar.
"""

NL = {
    'onderwerp_1': 'Herinnering: factuur %(nummer)s is vervallen',
    'onderwerp_2': 'Tweede herinnering: factuur %(nummer)s staat nog open',
    'onderwerp_3': 'Laatste herinnering: factuur %(nummer)s staat nog open',
    'kop': 'Betalingsherinnering',
    'koptekst_1': 'Factuur %(nummer)s is vervallen',
    'koptekst_2': 'Factuur %(nummer)s staat nog open',
    'koptekst_3': 'Factuur %(nummer)s staat nog steeds open',
    'inleiding_1': 'De betaaltermijn van onderstaande factuur is verstreken. Mogelijk is dit aan uw aandacht ontsnapt.',
    'inleiding_2': 'Onze factuur staat nog altijd open. Wij verzoeken u vriendelijk het bedrag alsnog over te maken.',
    'inleiding_3': 'Ondanks eerdere herinneringen is deze factuur nog niet voldaan. Wij verzoeken u dringend op korte termijn te betalen.',
    'factuurnummer': 'Factuurnummer',
    'factuurdatum': 'Factuurdatum',
    'vervaldatum': 'Vervaldatum',
    'dagen_te_laat': 'Dagen te laat',
    'bedrag': 'Openstaand bedrag',
    'slot': 'Heeft u de betaling inmiddels gedaan? Dan kunt u deze mail als niet verzonden beschouwen.',
    'portaal': 'U vindt al uw facturen terug in het klantenportaal.',
    'voettekst': 'Dit bericht is automatisch verstuurd door het transportmanagementsysteem van Moveo BV.',
}

EN = {
    'onderwerp_1': 'Reminder: invoice %(nummer)s is overdue',
    'onderwerp_2': 'Second reminder: invoice %(nummer)s is still outstanding',
    'onderwerp_3': 'Final reminder: invoice %(nummer)s is still outstanding',
    'kop': 'Payment reminder',
    'koptekst_1': 'Invoice %(nummer)s is overdue',
    'koptekst_2': 'Invoice %(nummer)s is still outstanding',
    'koptekst_3': 'Invoice %(nummer)s remains unpaid',
    'inleiding_1': 'The payment term for the invoice below has passed. This may have escaped your attention.',
    'inleiding_2': 'Our invoice is still outstanding. We kindly ask you to transfer the amount.',
    'inleiding_3': 'Despite earlier reminders this invoice remains unpaid. We urge you to pay without further delay.',
    'factuurnummer': 'Invoice number',
    'factuurdatum': 'Invoice date',
    'vervaldatum': 'Due date',
    'dagen_te_laat': 'Days overdue',
    'bedrag': 'Outstanding amount',
    'slot': 'If you have already paid, please disregard this message.',
    'portaal': 'All your invoices are available in the customer portal.',
    'voettekst': 'This message was sent automatically by the transport management system of Moveo BV.',
}

TR = {
    'onderwerp_1': 'Hatırlatma: %(nummer)s numaralı faturanın vadesi geçti',
    'onderwerp_2': 'İkinci hatırlatma: %(nummer)s numaralı fatura hâlâ ödenmedi',
    'onderwerp_3': 'Son hatırlatma: %(nummer)s numaralı fatura hâlâ ödenmedi',
    'kop': 'Ödeme hatırlatması',
    'koptekst_1': '%(nummer)s numaralı faturanın vadesi geçti',
    'koptekst_2': '%(nummer)s numaralı fatura hâlâ ödenmedi',
    'koptekst_3': '%(nummer)s numaralı fatura hâlen ödenmemiş durumda',
    'inleiding_1': 'Aşağıdaki faturanın ödeme süresi doldu. Gözünüzden kaçmış olabilir.',
    'inleiding_2': 'Faturamız hâlâ ödenmemiş durumda. Tutarı havale etmenizi rica ederiz.',
    'inleiding_3': 'Önceki hatırlatmalara rağmen bu fatura ödenmedi. En kısa sürede ödeme yapmanızı önemle rica ederiz.',
    'factuurnummer': 'Fatura numarası',
    'factuurdatum': 'Fatura tarihi',
    'vervaldatum': 'Son ödeme tarihi',
    'dagen_te_laat': 'Geciken gün',
    'bedrag': 'Ödenmemiş tutar',
    'slot': 'Ödemeyi yaptıysanız bu mesajı dikkate almayınız.',
    'portaal': 'Tüm faturalarınızı müşteri portalında görebilirsiniz.',
    'voettekst': 'Bu mesaj Moveo BV taşıma yönetim sistemi tarafından otomatik olarak gönderilmiştir.',
}

TALEN = {'nl': NL, 'en': EN, 'tr': TR}

MAX_RONDE_TEKST = 3


def teksten_voor(taal):
    return TALEN.get((taal or 'nl').lower(), NL)


def tekstronde(ronde: int) -> int:
    """Welke tekstvariant hoort bij deze herinnering; de laatste wordt hergebruikt."""
    return min(max(int(ronde), 1), MAX_RONDE_TEKST)
