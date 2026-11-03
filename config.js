// Site-wide settings. Override any of these with environment variables in production.
module.exports = {
  siteName: process.env.SITE_NAME || 'MineListings.zw',
  tagline: 'Mines and mining claims for sale in Zimbabwe',
  port: Number(process.env.PORT) || 3000,
  // Shown on the contact page and footer. Replace with your real details.
  contactEmail: process.env.CONTACT_EMAIL || 'info@example.com',
  contactPhone: process.env.CONTACT_PHONE || '',
  // International format without "+" or spaces, e.g. 263771234567. Leave empty to hide WhatsApp buttons.
  whatsapp: process.env.WHATSAPP_NUMBER || '',
  officeAddress: process.env.OFFICE_ADDRESS || 'Harare, Zimbabwe',
  cookieConsentVersion: 2,
  minerals: ['Gold', 'Chrome', 'Lithium', 'Copper', 'Antimony', 'Tin', 'Quartz', 'Lead', 'Coal', 'Diamonds', 'Platinum', 'Nickel', 'Iron Ore', 'Other'],
  provinces: [
    'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East', 'Mashonaland West',
    'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands',
  ],
  stages: ['Greenfield', 'Brownfield', 'Exploration', 'Partially operational', 'Operational', 'Not operational'],
  mandates: ['Owner', 'Direct Mandate', 'New Mandate', 'Agent'],
  documentOptions: [
    'Registration certificate', 'Geological report', 'Assay results', 'EIA certificate',
    'Maps & coordinates', 'Mining licence', 'Photos & video',
  ],
};
