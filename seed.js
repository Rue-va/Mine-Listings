// First-run data: an admin account and the launch listings supplied by the mandate holders.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, hashPassword, uniqueSlug } = require('./db');

const credits = require('./public/img/minerals/credits.json');

// Stock photos that work in a gallery but look odd as a listing's cover image
// (foreign landscapes, a satellite view, a dirt road).
const NOT_COVER = new Set(['gold-3.jpg', 'gold-5.jpg', 'chrome-3.jpg', 'quartz-3.jpg']);

// Rotate the cover photo so neighbouring cards don't all look the same.
function stockImages(mineral, offset) {
  const key = mineral.toLowerCase();
  const files = credits.filter((c) => c.mineral === key).map((c) => c.file);
  if (!files.length) return ['/img/minerals/hero-1.jpg'];
  const covers = files.filter((f) => !NOT_COVER.has(f));
  const cover = (covers.length ? covers : files)[offset % (covers.length || files.length)];
  return [cover, ...files.filter((f) => f !== cover)].map((f) => `/img/minerals/${f}`);
}

// One-off: re-pick cover photos for listings that still only use stock images.
function refreshStockCovers() {
  if (db.prepare("SELECT 1 FROM seed_log WHERE title = '__stock_covers_v3'").get()) return;
  const rows = db.prepare('SELECT id, mineral, images FROM listings').all();
  const update = db.prepare('UPDATE listings SET images = ? WHERE id = ?');
  for (const r of rows) {
    const imgs = JSON.parse(r.images || '[]');
    if (imgs.length && imgs.every((s) => s.startsWith('/img/minerals/'))) update.run(JSON.stringify(stockImages(r.mineral, r.id)), r.id);
  }
  db.prepare("INSERT INTO seed_log (title) VALUES ('__stock_covers_v3')").run();
}

const LISTINGS = [
  {
    title: 'Lalalapanzi 167ha Chrome Block', mineral: 'Chrome', location: 'Lalalapanzi', province: 'Midlands',
    area_ha: 167, grade: 'Cr 51%', price_usd: 250000, negotiable: 1, stage: 'Brownfield', mandate: 'Direct Mandate', featured: 1,
    summary: 'Proven chrome ground with shafts, an exposed belt and its own perennial stream.',
    description: `A working brownfield block in the middle of an active chrome district. Previous owners ran both alluvial and lumpy operations here, so you'll find existing workings and shafts, exposed chrome belts and a tunnel driven into the top of the hill.\n\nWater isn't a problem: a perennial stream runs through the block. Neighbouring claims are all being mined for chrome.\n\nThe owner has a geological report, coordinates, assay results, photos and the full registration paperwork ready to share with serious buyers.`,
    infrastructure: ['Existing shafts and workings', 'Tunnel on hilltop', 'Exposed chrome belts', 'Perennial stream inside the block'],
    documents: ['Registration certificate', 'Geological report', 'Assay results', 'Maps & coordinates', 'Photos & video'],
    paperwork_note: 'Fully registered, 1 block.',
  },
  {
    title: 'Ngezi 28ha Chrome Block', mineral: 'Chrome', location: 'Ngezi', province: 'Mashonaland West',
    area_ha: 28, grade: 'Cr 48% lumpy', price_usd: 40000, negotiable: 0, stage: 'Brownfield', mandate: 'New Mandate',
    summary: 'Small, affordable block of sugar lumpy chrome with belts already exposed.',
    description: `A compact 28ha block that suits a first-time chrome operator. The ore is sugar lumpy only, assaying at 48% Cr, and the belts are already exposed.\n\nPlease note there are no alluvials on this block. There's no geological report, but the full registration paperwork is available. At US$40,000 the price is fixed.`,
    infrastructure: ['Exposed chrome belts'],
    documents: ['Registration certificate'],
    paperwork_note: 'Fully registered, 1 block. No geological report.',
  },
  {
    title: 'Guruve 183ha Chrome Block', mineral: 'Chrome', location: 'Guruve', province: 'Mashonaland Central',
    area_ha: 183, grade: 'Cr 45–50%', price_usd: 200000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: 'Mostly lumpy chrome in a district surrounded by producing operations.',
    description: `A brownfield chrome block in Guruve, surrounded by working chrome mines. The ore here is mostly lumpy, grading 45–50% Cr. There are some alluvials, but not enough to be commercially significant.\n\nThe owner is honest that more exploration would help define the resource. There's no geological report yet; the registration paperwork is complete.`,
    infrastructure: [],
    documents: ['Registration certificate'],
    paperwork_note: 'Fully registered, 1 block. No geological report.',
  },
  {
    title: 'Guruve 202ha Chrome Block', mineral: 'Chrome', location: 'Guruve', province: 'Mashonaland Central',
    area_ha: 202, grade: 'Cr 45–50%', price_usd: 250000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: 'A larger Guruve chrome block. Lumpy ore at 45–50% Cr with neighbours in production.',
    description: `The larger of two Guruve chrome blocks we're marketing. It's a brownfield site, mostly lumpy ore at 45–50% Cr, and it's surrounded by active chrome operations.\n\nAlluvials are present but not of much commercial value, and a round of exploration is recommended before planning production. Full registration paperwork is available; there's no geological report.`,
    infrastructure: [],
    documents: ['Registration certificate'],
    paperwork_note: 'Fully registered, 1 block. No geological report.',
  },
  {
    title: 'Zvishavane 220ha Gold Mine', mineral: 'Gold', location: 'Zvishavane', province: 'Midlands',
    area_ha: 220, grade: 'Au 7g/t', price_usd: 4000000, negotiable: 0, stage: 'Partially operational', mandate: null, featured: 1,
    summary: 'Seven shafts, stamp mills, power and a 300,000t dump. Partially operational today.',
    description: `An established gold mine with real infrastructure already in place. Assays come in at around 7g/t, and there's a 300,000 tonne dump on site averaging 0.4g/t, which could be worth processing in its own right.\n\nThere are seven shafts. Five are currently worked by artisanal miners; some of the others have flooded, which is what stopped commercial operations. Dewatering them is the obvious first job for a new owner.\n\nThe geological report is available, and the owner will show the full compliance paperwork at a face-to-face meeting.`,
    infrastructure: ['7 shafts (5 under artisanal operation)', 'Stamp mills', 'Head gears', 'Tanks', 'Electricity connected', 'Staff quarters', 'Dump: 300,000t at ~0.4g/t'],
    documents: ['Geological report', 'Registration certificate'],
    paperwork_note: 'Full compliance paperwork shown when you meet the owner.',
  },
  {
    title: 'Inyathi 700ha Gold Oxide Blocks', mineral: 'Gold', location: 'Inyathi', province: 'Matabeleland North',
    area_ha: 700, grade: 'Au 0.3–11g/t', price_usd: 300000, price_label: 'per 10ha block', negotiable: 1, stage: 'Greenfield', mandate: 'Direct Mandate',
    summary: 'Flat virgin oxide ground on the Bulawayo–Bubi greenstone belt. Ideal for heap leaching.',
    description: `700ha of flat, untouched land sitting between the Isabela and Bubi gold mines on the Bulawayo–Bubi greenstone belt, about 50km north-west of Turk Mine.\n\nThe ore is around 95% oxidised, so it's well suited to cheap open-cast mining and heap leaching. Assays range from 0.3g/t up to 11g/t. The ground was pegged by a senior, well-respected Zimbabwean geologist, and the mineralisation has been mapped carefully.\n\nBlocks are sold in 10ha units. Registration paperwork and geotechnical reports exist, but the owner will only share paperwork, coordinates and maps after you've visited the site and had samples tested.`,
    infrastructure: ['Flat land suitable for heap leach pads'],
    documents: ['Registration certificate', 'Geological report', 'Maps & coordinates'],
    paperwork_note: 'Paperwork, coordinates and maps are shared after a site visit and sample tests.',
  },
  {
    title: 'Murewa 420ha Gold Oxides', mineral: 'Gold', location: 'Murewa (Nyanga borderlands)', province: 'Mashonaland East',
    area_ha: 420, grade: 'Au 0.5g/t', price_usd: 1500000, negotiable: 0, stage: 'Brownfield', mandate: 'Direct Mandate',
    summary: 'Large oxide block with gold reefs, BIF and a power line crossing the ground.',
    description: `A large block reached by 120km of tar and then 60km of dirt road towards the Nyanga borderlands. Gold reefs average 1.5m wide and there's a 2m banded iron formation (BIF). Old shafts and recent trenches expose both the belts and the reefs.\n\nThe ground also shows a strong presence of maneb, talc, beryllium, green tourmaline and blue sapphire. There's plenty of mountain and flat land for leach pads and a processing plant, and an electricity power line runs across the blocks.\n\nThe block is fully registered. There's no EIA and no geological report yet.`,
    infrastructure: ['Power line across the blocks', 'Old shafts', 'Recent trenches exposing reefs', 'Flat land for leaching and a plant'],
    documents: ['Registration certificate', 'Photos & video'],
    paperwork_note: 'Fully registered. No EIA, no geological report.',
  },
  {
    title: 'Shurugwi 160ha Oxidised Gold (4 Blocks)', mineral: 'Gold', location: 'Shurugwi (Boterekwa)', province: 'Midlands',
    area_ha: 160, grade: 'Au 3–5g/t', price_usd: 650000, negotiable: 1, stage: 'Brownfield', mandate: 'New Mandate',
    summary: 'Four oxide blocks near Boterekwa, heavily trenched, with heap leach operations next door.',
    description: `Four oxidised gold blocks in the Boterekwa area of Shurugwi, grading 3–5g/t. The ground has been extensively trenched, pitted and worked, so the belts are fully exposed and easy to sample.\n\nA large Chinese heap leach operation runs on the neighbouring blocks, and there's artisanal activity scattered around. There's flat ground for a leach plant, river water nearby and power lines close by.\n\nFully registered, with a map available. Photos on request.`,
    infrastructure: ['Extensive trenches, pits and shafts', 'Flat ground for leach plant', 'River water nearby', 'Power lines nearby'],
    documents: ['Registration certificate', 'Maps & coordinates', 'Photos & video'],
    paperwork_note: 'Fully registered, map available.',
  },
  {
    title: 'Mashava 35ha Operational Gold Mine', mineral: 'Gold', location: 'Mashava', province: 'Masvingo',
    area_ha: 35, grade: 'Au 5–25g/t', price_usd: 12000000, negotiable: 1, stage: 'Operational', mandate: 'Direct Mandate', featured: 1,
    summary: 'A running mine with a CIP plant, defined reserves and a 400,000t untreated dump.',
    description: `This is a producing mine with independently categorised reserves, recently re-valued at US$12 million.\n\nAssays range from 5g/t to 25g/t. Before haulage and milling losses, reserves stand at 772.97 oz proven, 9,581.3 oz indicated and 3,953.95 oz inferred. After losses that's roughly 657.02 oz proven, 8,144.1 oz indicated and 3,360.86 oz inferred. Auger drilling to 3.5m was done across the tailings dump, which holds about 400,000 tonnes of untreated material.\n\nThe site comes fully equipped and fenced, with housing for 60 workers. Full compliance paperwork is shown at a meeting with the owner.`,
    infrastructure: ['150t CIP plant', '100t gravity plant', '3 stamp mills', '1 head gear', '1 MVA transformer', '2 shaft pumps', 'Housing compound for 60 workers', 'Office block (3 offices)', "Managers' residence", 'Front-end loader', '2 JCBs', 'Borehole', 'Perimeter fully fenced', '3 storage containers'],
    documents: ['Registration certificate', 'Geological report', 'Assay results', 'Mining licence'],
    paperwork_note: 'Full compliance paperwork available when you meet the owner.',
  },
  {
    title: 'Shurugwi 300ha Oxidised Gold Deposit', mineral: 'Gold', location: 'Shurugwi (north of Boterekwa)', province: 'Midlands',
    area_ha: 300, grade: 'Au 0.5–4g/t', price_usd: 300000, price_label: 'per 10ha block', negotiable: 1, stage: 'Brownfield', mandate: 'Direct Mandate',
    summary: 'A 3.5km-long oxide ore body, 95% oxidised, with dams on both sides and power across the blocks.',
    description: `North of Boterekwa, reached past Guinea Fowl school. The ore body is 20–80m wide with a 3.5km strike and is about 95% oxidised. Grades of 0.5–4g/t come from trench sampling and fire assays.\n\nHeavy trenching has exposed the ore bodies in two or three places. The blocks border the Wonderer Mining area on the western side, and there are large heap leach operations in the surrounding area. There's flat ground for a leach plant, two dams (including Lucia Port dam) on either side, and power lines running across the blocks.\n\nFully registered and paid up. The owner meets genuine investors by appointment and brings the certificates and maps in person. General coordinates are available from the consulting geologists.`,
    infrastructure: ['Power lines across the blocks', '2 dams (incl. Lucia Port dam)', 'Extensive trenching', 'Flat ground for a leach plant'],
    documents: ['Registration certificate', 'Assay results', 'Maps & coordinates'],
    paperwork_note: 'Fully registered and paid up. Certificates and maps presented in person.',
  },
  {
    title: 'Goromonzi 500ha Gold Oxide Blocks', mineral: 'Gold', location: 'Goromonzi', province: 'Mashonaland East',
    area_ha: 500, grade: 'Au 0.5–4g/t', price_usd: 3500000, negotiable: 0, stage: 'Greenfield', mandate: null,
    summary: "Licensed and ready to mine, about 25km from Harare, with geological and magnetic surveys done.",
    description: `Just 23km from Harare on tar plus 2km off-road, this greenfield property shows gold-bearing oxides in red soils and on the hills inside the blocks. Assays run 0.5–4g/t, and there's mica on the ground too.\n\nA small dam on site holds enough water for commercial mining. Both a geological survey and a magnetic survey have been completed.\n\nFully registered with mining licence certificates, so it's ready to mine.`,
    infrastructure: ['Small dam (enough for commercial operations)', 'Close to Harare'],
    documents: ['Registration certificate', 'Mining licence', 'Geological report'],
    paperwork_note: 'Fully registered with mining licence certificates. Geological & magnetic survey reports.',
  },
  {
    title: 'Mutawatawa 40ha Functional Gold Mine', mineral: 'Gold', location: 'Mutawatawa (via Murewa)', province: 'Mashonaland East',
    area_ha: 40, grade: 'Au 0.5–9.4g/t', price_usd: 5500000, negotiable: 0, stage: 'Operational', mandate: 'Direct Mandate',
    summary: 'A functioning underground mine with milling, leaching and a 20,000t+ dump.',
    description: `A working gold mine about 160km on tar and 15km of gravel from Murewa Centre. Grades range from 0.5g/t up to 9.4g/t, and two exploration holes have been drilled with assays done.\n\nThe mine runs two underground shafts, is on grid power and has a full processing set-up on site. There's also a dump of more than 20,000 tonnes.\n\nFully registered and licensed. Photos are available on request.`,
    infrastructure: ['2 underground shafts', '2 × 5-ton ball mills', '5-ton round mills', 'Electricity', 'Compressors', 'Leaching tanks', 'Tipper truck', 'Workshop', 'Mine house', 'Wash plants', 'Crushing unit', 'Dump: 20,000t+'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results', 'Photos & video'],
    paperwork_note: 'Fully registered & licensed.',
  },
  {
    title: 'Masvingo 60ha Gold Mine (Reefs & Oxides)', mineral: 'Gold', location: 'Masvingo', province: 'Masvingo',
    area_ha: 60, grade: 'Au 5g/t', price_usd: 9500000, negotiable: 0, stage: 'Not operational', mandate: 'Direct Mandate', featured: 1,
    summary: 'A brand-new CIL plant and 30 leach tanks on reef and oxide ground. Power on, ready to run.',
    description: `About 15km of tar and 10km off-road from Masvingo. The mine has both reefs and oxides at around 5g/t, with trenches, an open-cast pit and old German shaft workings on site. Trenching has fully exposed the belts for sampling.\n\nIt isn't operating right now, but every installation is brand new and the electricity is fully connected, so it's ready to start.\n\nFully registered, with a core-drilling MID evaluation report available.`,
    infrastructure: ['New CIL plant', '30 × 50t leaching tanks', 'Boilers', 'Modern carbon room', 'Round mills', 'Staff quarters', 'Electricity fully installed'],
    documents: ['Registration certificate', 'Geological report', 'Photos & video'],
    paperwork_note: 'Fully registered. Core-drilling MID evaluation report available.',
  },
  {
    title: 'Mutoko 150ha Quartz Claim', mineral: 'Quartz', location: 'Mutoko (Mudzi District)', province: 'Mashonaland East',
    area_ha: 150, grade: null, price_usd: 550000, negotiable: 0, stage: 'Greenfield', mandate: null,
    summary: 'Quartz claim with belts exposed on outcrops, ready for sampling.',
    description: `A 150ha quartz claim in the Mudzi District. The belts are exposed on the outcrops, so sampling is straightforward.\n\nFully registered. There's no geological report yet.`,
    infrastructure: ['Belts exposed on outcrops'],
    documents: ['Registration certificate'],
    paperwork_note: 'Fully registered. No geological report.',
  },
  {
    title: 'Kamativi 150ha Tin Claim', mineral: 'Tin', location: 'Kamativi', province: 'Matabeleland North',
    area_ha: 150, grade: 'Sn 0.28%', price_usd: 450000, negotiable: 0, stage: 'Greenfield', mandate: 'New Mandate',
    summary: "A tin claim in Zimbabwe's historic tin district, grading 0.28%.",
    description: `A 150ha tin claim in Kamativi, which has a long history as a tin district. Grades come in at 0.28%, and the belts are exposed for sampling.\n\nFully registered. There's no geological report yet.`,
    infrastructure: ['Belts exposed for sampling'],
    documents: ['Registration certificate'],
    paperwork_note: 'Fully registered. No geological report.',
  },
  {
    title: 'Shangani 730ha Lithium Mine', mineral: 'Lithium', location: 'Shangani', province: 'Midlands',
    area_ha: 730, grade: 'Li 3%', price_usd: 800000, negotiable: 0, stage: 'Brownfield', mandate: null, featured: 1,
    summary: 'High-grade spodumene next to Zulu Lithium, 40km off the Harare–Bulawayo highway.',
    description: `A large lithium property 40km from the Harare–Bulawayo highway, right next to the Zulu Lithium mine. Assays show Li at 3%.\n\nThere are plenty of workings and trenches across all the blocks, exposing the belts, and samples show significant spodumene.\n\nFully registered with mining licence certificates. A geological survey report hasn't been done yet.`,
    infrastructure: ['Workings and trenches across all blocks', 'Close to Harare–Bulawayo highway'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results'],
    paperwork_note: 'Fully registered with mining licence / certificates. No geological survey report yet.',
  },
  {
    title: 'Fort Rixon 780ha Lithium Blocks', mineral: 'Lithium', location: 'Fort Rixon', province: 'Matabeleland South',
    area_ha: 780, grade: 'Li 0.5–1%', price_usd: 400000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: 'Lithium and potassium feldspar on 780ha, 12km from Zulu Lithium. EIA on file.',
    description: `780ha of lithium ground 12km from the Zulu Lithium mine. It's 40km from the Masvingo–Bulawayo highway, 70km from the Harare–Bulawayo highway and 97km from the Bulawayo–Beitbridge highway.\n\nWorkings and trenches across all the blocks expose the belts. Samples show lithium at 0.5–1% and a significant amount of potassium feldspar. There's plenty of room to build a processing plant for beneficiation and concentrates.\n\nFully registered with a mining licence and an EIA on file, so it's ready to mine. No geological survey report yet.`,
    infrastructure: ['Workings and trenches across all blocks', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'EIA certificate'],
    paperwork_note: 'Fully registered with mining licence and EIA on file.',
  },

  // ---- Batch 2 ----
  {
    title: 'Pfungwe 5,625ha Lithium Blocks', mineral: 'Lithium', location: 'Pfungwe, UMP District', province: 'Mashonaland East',
    area_ha: 5625, grade: 'Li 0.6–3%', price_usd: 10000000, negotiable: 0, stage: 'Exploration', mandate: null, featured: 1,
    summary: 'A very large spodumene holding across five areas of UMP District, with a detailed geological survey.',
    description: `One of the biggest lithium holdings we've listed: 5,625ha spread across Kafura, Nyakanwa, Pfungwe, Ngarwe and Rwanga in Uzumba-Maramba-Pfungwe (UMP) District.\n\nThe mineral is spodumene, grading 0.6–3% Li. There are plenty of exposed outcrops and pits across the sites, so sampling is straightforward.\n\nA detailed geological survey report and coordinates are available.`,
    infrastructure: ['Exposed outcrops and pits across the sites'],
    documents: ['Geological report', 'Maps & coordinates'],
    paperwork_note: 'Detailed geological survey report and coordinates available.',
  },
  {
    title: 'Kwekwe 1,151ha Antimony & Gold Blocks', mineral: 'Antimony', location: 'Munyati, 15km from Kwekwe CBD', province: 'Midlands',
    area_ha: 1151, grade: 'Sb 4–9%', price_usd: null, price_label: 'Price negotiable', negotiable: 1, stage: 'Greenfield', mandate: 'New Mandate',
    summary: 'Large, mostly untouched antimony and gold ground 15km from Kwekwe, with grid power nearby.',
    description: `1,151ha in the Munyati area, about 15km from Kwekwe CBD. Assays show antimony at 4–9%, and the ground also carries gold.\n\nOnly very small workings have been done, so it's largely greenfield and open for proper exploration. The electricity grid is within a 10km radius, and Munyati power station is close by.\n\nThere's no geological report, but assay results are available. Fully registered with mining licences and certificates. The price is open to negotiation.`,
    infrastructure: ['Grid power within 10km (Munyati power station)', 'Small existing workings'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results'],
    paperwork_note: 'Fully registered with mining licences / certificates. No geological report.',
  },
  {
    title: 'Nkayi 733ha Copper Blocks', mineral: 'Copper', location: 'Bubi District (Inyathi area)', province: 'Matabeleland North',
    area_ha: 733, grade: 'Cu 1.18–3.05%', price_usd: 1500000, negotiable: 1, stage: 'Exploration', mandate: 'Direct Mandate',
    summary: 'Copper blocks with old trenching, surface assays and a geological report.',
    description: `733ha of copper ground in the Inyathi area of Bubi District. Surface samples assay at 1.18–3.05% copper, and there's old trenching on the blocks.\n\nA geological report is available and the blocks are fully registered.`,
    infrastructure: ['Old trenching'],
    documents: ['Registration certificate', 'Geological report', 'Assay results'],
    paperwork_note: 'Full registration. Geological report available.',
  },
  {
    title: 'Kenzamba 98ha Copper Mine', mineral: 'Copper', location: 'Kenzamba', province: 'Mashonaland West',
    area_ha: 98, grade: 'Cu 25–33%', price_usd: 1500000, negotiable: 0, stage: 'Operational', mandate: 'New Mandate',
    summary: 'High-grade operational copper mine with open-cast shafts and stockpiles ready for sampling.',
    description: `An operational copper mine with very high grades of 25–33% Cu. There are workings and open-cast shafts on site, belts average about 1m, and small stockpiles are ready for sampling.\n\nThere isn't much infrastructure yet, but there's room to set up a processing plant on site. There's no geological survey, and more exploration is needed.\n\nFully registered with the mining licence on file, so it's ready to mine. Photos and assays are available.`,
    infrastructure: ['Workings and open-cast shafts', 'Small stockpiles for sampling', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results', 'Photos & video'],
    paperwork_note: 'Fully registered with mining licence on file. No geological survey.',
  },
  {
    title: 'Karoi 129ha Copper Mine', mineral: 'Copper', location: 'Karoi', province: 'Mashonaland West',
    area_ha: 129, grade: 'Cu 10–15%', price_usd: 400000, negotiable: 0, stage: 'Brownfield', mandate: 'New Mandate',
    summary: 'Copper block with old workings and 1m belts, priced for a smaller operator.',
    description: `A 129ha copper block grading 10–15% Cu. There are old workings, and some of the open cast collapsed during the rainy season. Belts average about 1m, and there's a small amount of material available for sampling.\n\nThere isn't much infrastructure, but the site suits a processing plant. No geological survey yet, so more exploration is needed.\n\nFully registered with the mining licence on file. Photos and assays are available.`,
    infrastructure: ['Old workings', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results', 'Photos & video'],
    paperwork_note: 'Fully registered with mining licence on file. No geological survey.',
  },
  {
    title: 'Hwange 450ha Copper Mine', mineral: 'Copper', location: 'Hwange', province: 'Matabeleland North',
    area_ha: 450, grade: 'Cu 5–30%', price_usd: 1500000, negotiable: 0, stage: 'Brownfield', mandate: 'Direct Mandate',
    summary: 'Outright sale: 450ha of copper blocks with plenty of shafts and workings.',
    description: `Copper blocks covering 450ha near Hwange, with samples ranging from 5% to 30% Cu. There are plenty of workings and shafts on site, but not much infrastructure.\n\nNo geological survey has been done and more exploration is needed. The ground is suitable for setting up a processing plant.\n\nThis is an outright sale. Fully registered with the mining licence on file. Photos are available.`,
    infrastructure: ['Workings and shafts', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Photos & video'],
    paperwork_note: 'Outright sale. Fully registered with mining licence on file. New direct mandate.',
  },
  {
    title: 'Chiredzi 1,386ha Copper Mine', mineral: 'Copper', location: 'Malipati area, Chiredzi', province: 'Masvingo',
    area_ha: 1386, grade: 'Cu 5–30%', price_usd: 4500000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: 'Outright sale: a big copper holding in the Malipati area with 1–3m belts.',
    description: `1,386ha of copper ground in the Malipati area of Chiredzi, inside the Gonarezhou coverage in the south-east. Samples range from 5% to 30% Cu.\n\nThere are plenty of workings and shafts, and the belts are 1–3m wide. There's no infrastructure on site. No geological survey yet, so exploration is needed to fully expose the resource. The site is suitable for a processing plant.\n\nThis is an outright sale. Fully registered with the mining licence on file. Photos are available.`,
    infrastructure: ['Workings and shafts', 'Belts 1–3m wide', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Photos & video'],
    paperwork_note: 'Outright sale. Fully registered with mining licence on file.',
  },
  {
    title: 'Chiredzi 150ha Copper Blocks', mineral: 'Copper', location: 'Malipati area, Chiredzi', province: 'Masvingo',
    area_ha: 150, grade: 'Cu 5–30%', price_usd: 1500000, negotiable: 1, stage: 'Exploration', mandate: null,
    summary: 'Outright sale: eight trenches already cut across 1–3m copper belts.',
    description: `A smaller 150ha copper block in the Malipati area of Chiredzi, inside the Gonarezhou coverage. Samples range from 5% to 30% Cu.\n\nEight trenches have already been cut, exposing belts 1–3m wide. There's no infrastructure on site, and no geological survey has been done. More exploration is needed to fully expose the resource. The site is suitable for a processing plant.\n\nThis is an outright sale, and the price is negotiable. Fully registered with the mining licence on file.`,
    infrastructure: ['8 trenches', 'Belts 1–3m wide', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Photos & video'],
    paperwork_note: 'Outright sale. Fully registered with mining licence on file.',
  },
  {
    title: 'Gokwe North 261ha Copper Mine', mineral: 'Copper', location: 'Copper Queen area, Gokwe North', province: 'Midlands',
    area_ha: 261, grade: 'Cu 5–30%', price_usd: 1500000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: 'Outright sale: copper blocks in the Copper Queen area with shafts that make sampling easy.',
    description: `261ha of copper blocks in the Copper Queen area of Gokwe North. Samples range from 5% to 30% Cu.\n\nThere are plenty of workings and shafts, which makes sampling easy. Belts are 1–2m wide. There's no infrastructure, and no geological survey yet, so more exploration is needed to fully expose the resource. The ground is suitable for a processing plant.\n\nThis is an outright sale. Fully registered with the mining licence on file. Photos are available.`,
    infrastructure: ['Workings and shafts', 'Belts 1–2m wide', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Photos & video'],
    paperwork_note: 'Outright sale. Fully registered with mining licence on file.',
  },
  {
    title: 'Mhangura 94ha Copper Mine', mineral: 'Copper', location: 'Mhangura', province: 'Mashonaland West',
    area_ha: 94, grade: 'Cu 5–15%', price_usd: 750000, negotiable: 0, stage: 'Brownfield', mandate: null,
    summary: "Outright sale: a copper block in one of Zimbabwe's best-known copper towns.",
    description: `A 94ha copper block at Mhangura, with samples at 5–15% Cu. There are workings on site but no infrastructure.\n\nNo geological survey has been done yet. More exploration would help quantify the resource and the life of the mine. The site is suitable for a processing plant.\n\nThis is an outright sale. Fully registered with the mining licence on file. Photos are available.`,
    infrastructure: ['Workings on site', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence', 'Photos & video'],
    paperwork_note: 'Outright sale. Fully registered with mining licence on file.',
  },
  {
    title: 'Hurungwe 113ha Copper Mine', mineral: 'Copper', location: 'Hurungwe', province: 'Mashonaland West',
    area_ha: 113, grade: 'Cu 7–12%', price_usd: 2500000, negotiable: 0, stage: 'Brownfield', mandate: 'New Mandate',
    summary: 'Copper mine with shafts and stockpiles. A joint venture is possible on agreed terms.',
    description: `A 113ha copper block in Hurungwe, with top samples at 7–12% Cu. There are workings and shafts on site, plus small stockpiles ready for sampling. There isn't much infrastructure.\n\nNo geological survey yet, so more exploration is needed. The site is suitable for a processing plant.\n\nFully registered with the mining licence on file. The owner is also open to a joint venture on agreed terms.`,
    infrastructure: ['Workings and shafts', 'Small stockpiles for sampling', 'Space for a processing plant'],
    documents: ['Registration certificate', 'Mining licence'],
    paperwork_note: 'Fully registered with mining licence on file. JV option available on agreed terms.',
  },
  {
    title: 'Gokwe North 10ha Gold & Lead Mine', mineral: 'Gold', location: 'Gokwe North (20km SW of Copper Queen mine)', province: 'Midlands',
    area_ha: 10, grade: 'Au 13–18g/t', price_usd: 380000, negotiable: 0, stage: 'Operational', mandate: null,
    summary: 'Small, high-grade operating mine with 13 cased shafts, a stamp mill and a carbon room.',
    description: `A compact operating mine with high grades of 13–18g/t gold, plus lead belts of 80cm–1.2m. It's about 120km off-road from Chinhoyi or Kadoma, 20km south-west of Copper Queen mine. The area is also known for rich antimony deposits.\n\nThere are 13 well-built, cased shafts, each about 35–40m deep, and they're easy to get into for sampling. On site you'll find a stamp mill, tanks, a carbon room and heavy-duty generators. Staff quarters are close to the main business centre, and electricity is nearby.\n\nThe owner may also sell an extra 5ha virgin block right next to the mine. Photos of the sites and video of the belts inside the shafts are available.\n\nFully registered (1 block). The owner shows the geological report and registration paperwork in person at the site visit, along with a current inspection certificate.`,
    infrastructure: ['13 cased shafts (35–40m each)', 'Stamp mill', 'Tanks', 'Carbon room', 'Heavy-duty generators', 'Staff quarters', 'Electricity nearby', 'Optional extra 5ha virgin block'],
    documents: ['Registration certificate', 'Geological report', 'Photos & video'],
    paperwork_note: 'Fully registered, 1 block. Geological report, registration and current inspection certificate shown at the site visit.',
  },
  {
    title: 'Murewa 165ha Gold Mine', mineral: 'Gold', location: 'Murewa', province: 'Mashonaland East',
    area_ha: 165, grade: 'Au 6–13g/t', price_usd: 1500000, negotiable: 0, stage: 'Partially operational', mandate: 'Direct Mandate',
    summary: 'Partially working gold mine, sold as a company with 100% share transfer.',
    description: `A partially working gold mine reached by 120km of tar and 40km of dirt road. Grades are 6–13g/t. Lithium, tantalite, vermiculite and epidotes are also present.\n\nIt isn't fully operating right now because the owners can't run it at full capacity. Controlled artisanal mining is going on, with lots of workings and shafts plus old open-cast workings. There's a dump on site, and the power line is 1.5km away.\n\nThe mine is registered under a company, and the sale is a 100% share transfer, so there's no need to transfer the title itself. A geological report is available, along with photos.`,
    infrastructure: ['Office and storeroom', 'Fence', 'Dump on site', '40,000L water container', 'Round mill', '3 treating tanks', 'Head gear and winch', 'Workshop', 'Amalgam barrel', 'Power line 1.5km away'],
    documents: ['Registration certificate', 'Geological report', 'Photos & video'],
    paperwork_note: 'Registered in a company name, sold as a 100% share transfer.',
  },
  {
    title: 'Silobela 132ha Antimony Block (Joint Venture)', mineral: 'Antimony', location: 'Silobela, 100km from Kwekwe CBD', province: 'Midlands',
    area_ha: 132, grade: 'Sb 30–40%, Au 3–5g/t', price_usd: null, price_label: 'Joint venture only', negotiable: 0, stage: 'Exploration', mandate: 'Direct Mandate',
    summary: 'Joint venture only: high-grade antimony with gold, next to a working antimony mine.',
    description: `A 132ha block in Silobela, about 100km from Kwekwe CBD, offered as a joint venture only. It isn't for sale outright.\n\nAssays show antimony at 30–40% and gold at 3–5g/t. There are plenty of outcrops, and the belts from the working antimony mine next door can be traced onto this block.\n\nFull compliance paperwork is in place. The commitment fee and JV terms are only shared with investors after sampling and a mine visit. The mandate holder charges consultancy fees for all mine visits.`,
    infrastructure: ['Outcrops and belt traces from neighbouring mine'],
    documents: ['Registration certificate', 'Mining licence', 'Assay results'],
    paperwork_note: 'Full compliance paperwork. Commitment fee and terms shared after sampling and a site visit. Consultancy fees apply to all mine visits.',
  },
  {
    title: 'Mashava 620ha Operational Gold Mine', mineral: 'Gold', location: 'Mashava', province: 'Masvingo',
    area_ha: 620, grade: 'Au 5g/t', price_usd: 7300000, negotiable: 0, stage: 'Operational', mandate: 'Direct Mandate', featured: 1,
    summary: 'Running mine with two open pits, a stamp mill, carbon room and full power.',
    description: `A large, working gold mine about 20km on tar and 1.5km off-road, grading around 5g/t. Two open-cast pits expose the belts, and trenching has been done around the blocks so the belts are ready to sample.\n\nThe mine has a full set-up on site, with power fully installed and a mine manager living there.\n\nFully registered, and a geological report is available. Photos on request.`,
    infrastructure: ['2 open-cast pits', 'Stamp mill', 'Carbon room', 'Excavator', 'Electricity fully installed', 'Staff quarters', 'Gold separation table', 'Mine manager on site'],
    documents: ['Registration certificate', 'Geological report', 'Photos & video'],
    paperwork_note: 'Fully registered. Geological report available.',
  },
  {
    title: 'Mashava 140ha Gold Blocks', mineral: 'Gold', location: 'Mashava', province: 'Masvingo',
    area_ha: 140, grade: 'Au 5g/t', price_usd: 2500000, negotiable: 0, stage: 'Brownfield', mandate: 'Direct Mandate',
    summary: 'Alluvial gold ground with active, controlled artisanal operations and trenches cut.',
    description: `140ha of gold blocks about 20km on tar and 13km off-road, grading around 5g/t. There's a lot of controlled artisanal alluvial gold mining on the ground right now, and trenches and open pits have already been dug.\n\nTrenching around the blocks has exposed the belts for sampling. There's no infrastructure on site.\n\nFully registered. No geological report yet. Photos are available.`,
    infrastructure: ['Trenches and open pits', 'Controlled artisanal alluvial operations'],
    documents: ['Registration certificate', 'Photos & video'],
    paperwork_note: 'Fully registered. No geological report.',
  },
];

function ensureAdmin() {
  const existing = db.prepare("SELECT id, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (existing) {
    if (process.env.ADMIN_RESET_PASSWORD) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(process.env.ADMIN_RESET_PASSWORD), existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
      console.log(`\n  Admin password reset for ${existing.email}. Remove ADMIN_RESET_PASSWORD now.\n`);
    }
    return;
  }
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run('Site Admin', email, hashPassword(password));
  const note = `Admin login\nEmail: ${email}\nPassword: ${password}\n\nChange this password after your first login (Admin → Account).\n`;
  if (!process.env.ADMIN_PASSWORD) fs.writeFileSync(path.join(__dirname, 'data', 'admin-credentials.txt'), note);
  console.log(`\n  Created admin account: ${email} / ${process.env.ADMIN_PASSWORD ? '(from ADMIN_PASSWORD)' : password}\n`);
}

// Each seed listing is added once, keyed by title, so new batches can be appended to a live
// database and listings an admin has deleted don't come back.
function seedListings() {
  db.exec('CREATE TABLE IF NOT EXISTS seed_log (title TEXT PRIMARY KEY)');
  if (!db.prepare('SELECT COUNT(*) AS n FROM seed_log').get().n) {
    db.exec('INSERT OR IGNORE INTO seed_log (title) SELECT title FROM listings');
  }
  const done = new Set(db.prepare('SELECT title FROM seed_log').all().map((r) => r.title));
  const fresh = LISTINGS.filter((l) => !done.has(l.title));
  if (!fresh.length) return;
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  const log = db.prepare('INSERT INTO seed_log (title) VALUES (?)');
  const insert = db.prepare(`INSERT INTO listings
    (slug, title, mineral, location, province, area_ha, grade, price_usd, price_label, negotiable, stage, summary, description,
     infrastructure, documents, paperwork_note, mandate, images, status, featured, owner_id, created_at, updated_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, datetime('now', ?), datetime('now', ?), datetime('now'))`);
  fresh.forEach((l) => {
    // Stagger the dates so "newest first" has a sensible order.
    const i = LISTINGS.indexOf(l);
    const age = `-${(LISTINGS.length - i) * 2} days`;
    log.run(l.title);
    insert.run(uniqueSlug(l.title), l.title, l.mineral, l.location, l.province, l.area_ha, l.grade, l.price_usd, l.price_label || null,
      l.negotiable, l.stage, l.summary, l.description, JSON.stringify(l.infrastructure), JSON.stringify(l.documents),
      l.paperwork_note, l.mandate, JSON.stringify(stockImages(l.mineral, i)), l.featured || 0, admin.id, age, age);
  });
  console.log(`  Added ${fresh.length} listing${fresh.length === 1 ? '' : 's'} from seed.js.`);
}

module.exports = function seed() {
  ensureAdmin();
  seedListings();
  refreshStockCovers();
};
