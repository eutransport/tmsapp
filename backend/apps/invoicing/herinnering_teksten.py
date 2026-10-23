"""Teksten voor de betalingsherinnering, per taal.

De taal volgt de mailinstelling van het bedrijf; ontbreekt die, dan Nederlands.
"""

NL = {
    'onderwerp_1': 'Herinnering: factuur %(nummer)s is vervallen',
    'onderwerp_7': 'Tweede herinnering: factuur %(nummer)s staat nog open',
    'onderwerp_14': 'Laatste herinnering: factuur %(nummer)s staat nog open',
    'kop': 'Betalingsherinnering',
    'koptekst_1': 'Factuur %(nummer)s is vervallen',
    'koptekst_7': 'Factuur %(nummer)s staat nog open',
    'koptekst_14': 'Factuur %(nummer)s staat nog steeds open',
    'inleiding_1': 'De betaaltermijn van onderstaande factuur is verstreken. Mogelijk is dit aan uw aandacht ontsnapt.',
    'inleiding_7': 'Onze factuur staat inmiddels een week open. Wij verzoeken u vriendelijk het bedrag alsnog over te maken.',
    'inleiding_14': 'Ondanks eerdere herinneringen is deze factuur nog niet voldaan. Wij verzoeken u dringend binnen vijf dagen te betalen.',
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
    'onderwerp_7': 'Second reminder: invoice %(nummer)s is still outstanding',
    'onderwerp_14': 'Final reminder: invoice %(nummer)s is still outstanding',
    'kop': 'Payment reminder',
    'koptekst_1': 'Invoice %(nummer)s is overdue',
    'koptekst_7': 'Invoice %(nummer)s is still outstanding',
    'koptekst_14': 'Invoice %(nummer)s remains unpaid',
    'inleiding_1': 'The payment term for the invoice below has passed. This may have escaped your attention.',
    'inleiding_7': 'Our invoice has now been outstanding for a week. We kindly ask you to transfer the amount.',
    'inleiding_14': 'Despite earlier reminders this invoice remains unpaid. We urge you to pay within five days.',
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
    'onderwerp_1': 'Hatirlatma: %(nummer)s numarali faturanin vadesi gecti',
    'onderwerp_7': 'Ikinci hatirlatma: %(nummer)s numarali fatura hala odenmedi',
    'onderwerp_14': 'Son hatirlatma: %(nummer)s numarali fatura hala odenmedi',
    'kop': 'Odeme hatirlatmasi',
    'koptekst_1': '%(nummer)s numarali faturanin vadesi gecti',
    'koptekst_7': '%(nummer)s numarali fatura hala odenmedi',
    'koptekst_14': '%(nummer)s numarali fatura halen odenmemis durumda',
    'inleiding_1': 'Asagidaki faturanin odeme suresi doldu. Gozunuzden kacmis olabilir.',
    'inleiding_7': 'Faturamiz bir haftadir odenmemis durumda. Tutari havale etmenizi rica ederiz.',
    'inleiding_14': 'Onceki hatirlatmalara ragmen bu fatura odenmedi. Bes gun icinde odeme yapmanizi onemle rica ederiz.',
    'factuurnummer': 'Fatura numarasi',
    'factuurdatum': 'Fatura tarihi',
    'vervaldatum': 'Son odeme tarihi',
    'dagen_te_laat': 'Geciken gun',
    'bedrag': 'Odenmemis tutar',
    'slot': 'Odemeyi yaptiysaniz bu mesaji dikkate almayiniz.',
    'portaal': 'Tum faturalarinizi musteri portalinda gorebilirsiniz.',
    'voettekst': 'Bu mesaj Moveo BV tasima yonetim sistemi tarafindan otomatik olarak gonderilmistir.',
}

TALEN = {'nl': NL, 'en': EN, 'tr': TR}


def teksten_voor(taal):
    return TALEN.get((taal or 'nl').lower(), NL)
