const CURRENCY_BY_COUNTRY: Record<string, string> = {
    EG: 'EGP',
    SA: 'SAR',
};

export function currencyForCountry(countryCode: string): string {
    const code = CURRENCY_BY_COUNTRY[countryCode.toUpperCase()];
    if (!code) throw new Error(`No currency configured for country: ${countryCode}`);
    return code;
}
