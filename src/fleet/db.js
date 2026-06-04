// Complete ship database for all factions, sourced from the fleet stat PDFs.
// Each entry matches the engine def format used in constants.js.
// `groupSize` here is the default (base) group size; the import parser overrides it
// with the actual count from the list.

const W = (name, arc, att, lock, dmg, type, special = '—') =>
  ({ name, arc, att, lock, dmg, type, special });
const L = (name, n, type) => ({ name, n, type });

// ── UCM ──────────────────────────────────────────────────────────────────────

const UCM = {
  // ── Corvettes / Stealth Lighters ──────────────────────────────────────────
  'Santiago Corvette':      { role:'Corvette',           pts:20,  tonnage:'L', groupSize:2, thrust:14, scan:6,  sig:2,  hull:2,  es:'5+', ks:'6+', bs:'—', weapons:[W('Stingray Missile Bays','F/S/R',4,'3+',1,'K','Air to Air, Close Action')], special:'Descent, Rare' },
  'Lysander Stealth Lighter':{ role:'Stealth Lighter',   pts:25,  tonnage:'L', groupSize:2, thrust:12, scan:6,  sig:0,  hull:2,  es:'6+', ks:'6+', bs:'—', weapons:[W('Barracuda Missile Bays','F/S/R',2,'4+',1,'K','Close Action')], launch:[L('Dropships',1,'dropship')], special:'Descent, Cloak-1, Rare, Vanguard-6", Stealth Drop' },
  // ── Frigates ──────────────────────────────────────────────────────────────
  'Toulon Frigate':         { role:'Frigate',             pts:30,  tonnage:'L', groupSize:2, thrust:10, scan:6,  sig:3,  hull:4,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret Triad','F/S',3,'4+',1,'K','Fusillade-2')], special:'—' },
  'Taipei Missile Frigate': { role:'Frigate',             pts:40,  tonnage:'L', groupSize:2, thrust:10, scan:6,  sig:3,  hull:4,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—'),W('Piranha Missile Turrets','F/S',6,'4+',1,'K','Close Action')], special:'—' },
  'Jakarta Aegis Frigate':  { role:'Frigate',             pts:42,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:3,  hull:4,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—'),W('Aegis-V Array','F/S/R',4,'3+',0,'E','Anti-Wing, Close Action, Fusillade-2')], special:'Aegis-2' },
  'Lima Detector Frigate':  { role:'Detector Frigate',   pts:40,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:3,  hull:4,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—')], special:'Detector, Rare' },
  'New Orleans Strike Carrier':{ role:'Strike Carrier',  pts:45,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:3,  hull:4,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—')], launch:[L('Dropships',1,'dropship')], special:'Descent' },
  'Sheffield Heavy Frigate':{ role:'Heavy Frigate',      pts:45,  tonnage:'L', groupSize:1, thrust:8,  scan:6,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—'),W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2')], special:'—' },
  'Detroit Heavy Frigate':  { role:'Heavy Frigate',      pts:50,  tonnage:'L', groupSize:1, thrust:8,  scan:6,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('UF-2200 Mass Driver Turret','F/S',1,'4+',1,'K','—'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1')], special:'—' },
  // ── Monitors ──────────────────────────────────────────────────────────────
  'Istanbul Monitor':       { role:'Monitor',            pts:50,  tonnage:'L', groupSize:1, thrust:6,  scan:6,  sig:4,  hull:4,  es:'3+', ks:'4+', bs:'6+', weapons:[W('UF-B-9000s (Anti-Ship)','FN',3,'3+',2,'K','Alt-1'),W('UF-B-9000s (Bombardment)','F',2,'4+',2,'K','Alt-1, Bombardment')], special:'Monitor' },
  'Vienna Escort Frigate':  { role:'Escort Frigate',     pts:66,  tonnage:'L', groupSize:1, thrust:6,  scan:6,  sig:4,  hull:4,  es:'3+', ks:'4+', bs:'6+', weapons:[W('Mamba Laser','FN',3,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], special:'Aegis-3, Escort' },
  // ── Cutters ───────────────────────────────────────────────────────────────
  'Reykjavik Cutter':       { role:'Cutter',             pts:45,  tonnage:'L', groupSize:2, thrust:14, scan:6,  sig:3,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('UF-9000-S Twin Mass Driver','FN',2,'3+',2,'K','—')], special:'Vectored' },
  'Nuuk EM Harasser':       { role:'Cutter',             pts:35,  tonnage:'L', groupSize:2, thrust:14, scan:6,  sig:3,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Haywire Blaster','F',1,'4+',0,'E','Status')], special:'Vectored, Rare' },
  'Oslo Cutter':            { role:'Cutter',             pts:57,  tonnage:'L', groupSize:2, thrust:14, scan:6,  sig:3,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Adder Multi Laser','FN',3,'2+',1,'E','Scald-2')], special:'Vectored' },
  // ── Destroyers ────────────────────────────────────────────────────────────
  'Havana Destroyer':       { role:'Destroyer',          pts:45,  tonnage:'L', groupSize:2, thrust:10, scan:6,  sig:4,  hull:6,  es:'4+', ks:'4+', bs:'—', weapons:[W('Shark Missile Bays','F/S/R',5,'4+',1,'K','Close Action')], launch:[L('Light Torpedo',1,'torpedo')], special:'Rare' },
  'Vancouver Escort Carrier':{ role:'Escort Carrier',   pts:55,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:4,  hull:6,  es:'4+', ks:'4+', bs:'—', weapons:[W('Barracuda Missile Bays','F/S/R',2,'4+',1,'K','Close Action')], launch:[L('Fighters & Bombers',1,'fighter_bomber')], special:'Escort' },
  'Kyiv Heavy Destroyer':   { role:'Heavy Destroyer',   pts:60,  tonnage:'L', groupSize:1, thrust:8,  scan:6,  sig:4,  hull:6,  es:'3+', ks:'4+', bs:'—', weapons:[W('UF-9000 Twin Mass Driver','F',2,'3+',2,'K','Fusillade-1, Re-Entry')], special:'—' },
  'Caracas Heavy Destroyer':{ role:'Heavy Destroyer',   pts:65,  tonnage:'L', groupSize:1, thrust:8,  scan:6,  sig:4,  hull:6,  es:'3+', ks:'4+', bs:'—', weapons:[W('Orca Missile Bays','F/S/R',7,'4+',1,'K','—'),W('HB-8800 Bombardment Spikes','F/S/R',2,'4+',2,'K','Bombardment, Scald-1, Critical-2')], special:'—' },
  // ── Light Cruisers ────────────────────────────────────────────────────────
  'Osaka Light Cruiser':    { role:'Light Cruiser',      pts:70,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:6,  hull:8,  es:'4+', ks:'3+', bs:'—', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1')], special:'—' },
  'New Cairo Light Cruiser':{ role:'Light Cruiser',      pts:70,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:6,  hull:8,  es:'4+', ks:'3+', bs:'—', weapons:[W('Cobra Heavy Laser','FN',4,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], special:'—' },
  'Boston Light Cruiser':   { role:'Light Cruiser',      pts:75,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:6,  hull:8,  es:'4+', ks:'3+', bs:'—', weapons:[W('Piranha Missile Turrets','F/S',6,'4+',1,'K','Close Action')], launch:[L('Medium Torpedo',1,'torpedo')], special:'—' },
  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Rio Cruiser':            { role:'Cruiser',            pts:85,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Berlin Cruiser':         { role:'Cruiser',            pts:80,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('Cobra Heavy Laser','FN',4,'3+',1,'E','Burnthrough-1, Flash-1, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Madrid Cruiser':         { role:'Cruiser',            pts:86,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-B-8000 Bombardment Turret Pair','F/S/R',8,'4+',1,'K','Bombardment, Scald-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Bruges Cruiser':         { role:'Cruiser',            pts:84,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('Cobra Heavy Laser','FN',4,'3+',1,'E','Burnthrough-1, Flash-1, Focused'),W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2')], special:'—' },
  'Ulaanbaatar Cruiser':    { role:'Cruiser',            pts:90,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1'),W('Piranha Missile Turrets','F/S',6,'4+',1,'K','Close Action')], launch:[L('Medium Torpedo',1,'torpedo')], special:'Rare' },
  'Bucharest Cruiser':      { role:'Cruiser',            pts:90,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2'),W('Piranha Missile Turrets','F/S',6,'4+',1,'K','Close Action')], launch:[L('Medium Torpedo',1,'torpedo')], special:'Rare' },
  'Glasgow Cruiser':        { role:'Cruiser',            pts:98,  tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-B-8000 Bombardment Turret Pair','F/S/R',8,'4+',1,'K','Bombardment, Scald-1'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1')], special:'—' },
  'Geneva Command Cruiser': { role:'Command Cruiser',    pts:100, tonnage:'M', groupSize:1, thrust:8,  scan:10, sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'Command Ship-1, Detector, Unique' },
  'Seattle Fleet Carrier':  { role:'Fleet Carrier',     pts:116, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'—' },
  'New Mombasa Vanguard Carrier':{ role:'Vanguard Carrier', pts:120, tonnage:'M', groupSize:1, thrust:8, scan:6, sig:6, hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('Piranha Missile Turrets','F/S',6,'4+',1,'K','Close Action')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-4"', vanguard:4 },
  'San Francisco Troopship':{ role:'Troopship',          pts:100, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:6,  hull:10, es:'4+', ks:'3+', bs:'—', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Bulk Landers',4,'bulk_lander')], special:'—' },
  // ── Heavy Cruisers ────────────────────────────────────────────────────────
  'Warsaw Heavy Cruiser':   { role:'Heavy Cruiser',      pts:110, tonnage:'M', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:12, es:'4+', ks:'3+', bs:'6+', weapons:[W('Cobra Heavy Laser Pair','FN',6,'3+',1,'E','Burnthrough-2, Flash-2, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Vilnius Heavy Cruiser':  { role:'Heavy Cruiser',      pts:115, tonnage:'M', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:12, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1'),W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Edmonton Heavy Carrier': { role:'Heavy Carrier',      pts:135, tonnage:'M', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:12, es:'4+', ks:'3+', bs:'6+', weapons:[W('Cobra Heavy Laser','FN',4,'3+',1,'E','Burnthrough-1, Flash-1, Focused'),W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'—' },
  'Las Vegas Command Carrier':{ role:'Command Carrier',  pts:145, tonnage:'M', groupSize:1, thrust:7,  scan:10, sig:6,  hull:12, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Command Ship-1, Detector, Unique' },
  // ── Supercruisers ─────────────────────────────────────────────────────────
  'Yokohama Supercruiser':  { role:'Supercruiser',       pts:160, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-6400 Mass Driver Twin Turret','F/S',4,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], special:'Feature Carrier' },
  'Busan Supercruiser':     { role:'Supercruiser',       pts:166, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'4+', ks:'3+', bs:'6+', weapons:[W('Elapid Laser Turret','F/S',2,'2+',2,'E','Penetrator'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], special:'Feature Carrier' },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Johannesburg Battlecruiser':{ role:'Battlecruiser',   pts:165, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-6400 Mass Driver Twin Turrets','F/S',4,'3+',1,'K','Critical-1, Volley-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-4"', vanguard:4 },
  'Perth Battlecruiser':    { role:'Battlecruiser',      pts:145, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('Viper Super Heavy Laser','FN',8,'3+',1,'E','Bloom-1, Burnthrough-1, Flash-1, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'Vanguard-4"', vanguard:4 },
  'Rome Battlecruiser':     { role:'Battlecruiser',      pts:185, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Heavy Torpedo',2,'torpedo')], special:'Aegis-6, Vanguard-4"', vanguard:4 },
  'Venice Command Battlecruiser':{ role:'Battlecruiser', pts:185, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'Command Ship-2, Marines-1, Vanguard-4", UCMF Battlenet', vanguard:4 },
  'Siam Battlecruiser':     { role:'Battlecruiser',      pts:180, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('Elapid Laser Turrets','F/S',4,'2+',2,'E','Penetrator'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-4"', vanguard:4 },
  // ── Pocket Battleships ────────────────────────────────────────────────────
  'Hong Kong Pocket Battleship':{ role:'Pocket Battleship', pts:185, tonnage:'H', groupSize:1, thrust:7, scan:8, sig:6, hull:15, es:'4+', ks:'3+', bs:'5+', weapons:[W('Viper Super Heavy Laser','FN',8,'3+',1,'E','Bloom-1, Burnthrough-1, Flash-1, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], special:'Feature Carrier' },
  'New Dubai Pocket Battleship':{ role:'Pocket Battleship', pts:215, tonnage:'H', groupSize:1, thrust:7, scan:8, sig:6, hull:15, es:'4+', ks:'3+', bs:'5+', weapons:[W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1'),W('Arowana Missile Turrets','F/S/R',6,'3+',1,'K','Close Action, Scald-1'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Heavy Torpedo',2,'torpedo')], special:'Aegis-6, Feature Carrier' },
  'Rotterdam Pocket Battleship':{ role:'Pocket Battleship', pts:195, tonnage:'H', groupSize:1, thrust:7, scan:8, sig:6, hull:15, es:'4+', ks:'3+', bs:'5+', weapons:[W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2'),W('Taipan Laser Turrets','F/S',2,'2+',1,'E','Scald-2'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], special:'Command Ship-2, Feature Carrier, UCMA Battlenet' },
  'Milwaukee Pocket Battleship':{ role:'Pocket Battleship', pts:225, tonnage:'H', groupSize:1, thrust:7, scan:8, sig:6, hull:15, es:'4+', ks:'3+', bs:'5+', weapons:[W('Elapid Laser Turrets','F/S',4,'2+',2,'E','Penetrator'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('Swordfish Missile Bays','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Feature Carrier' },
  // ── Battleships ───────────────────────────────────────────────────────────
  'Beijing Battleship':     { role:'Battleship',         pts:220, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('Python Super Heavy Laser','FN',5,'3+',2,'E','Bloom-2, Burnthrough-2, Flash-1, Focused'),W('UF-6400 Mass Driver Turret Triad','F/S',6,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'New York Battleship':    { role:'Battleship',         pts:245, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'—' },
  'Tokyo Battleship':       { role:'Battleship',         pts:225, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('Python Super Heavy Laser','FN',5,'3+',2,'E','Bloom-2, Burnthrough-2, Flash-1, Focused'),W('UF-B-8000 Bombardment Turrets','F/S/R',12,'4+',1,'K','Bombardment, Scald-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Hanoi Battleship':       { role:'Battleship',         pts:200, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('UF-12000 Twin Mass Driver','FN',2,'2+',4,'C','Crippling'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'—' },
  'Delhi Battleship':       { role:'Battleship',         pts:230, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('UF-6400 Mass Driver Turrets','F/S',4,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Bulk Landers',8,'bulk_lander'),{name:'Drop Pods',n:2,type:'drop_pod',alt:'1'},{name:'Boarding Pods',n:2,type:'boarding_pod',alt:'1'}], special:'Marines-2' },
  // ── Dreadnoughts / Supercarriers ──────────────────────────────────────────
  'London Dreadnought':     { role:'Dreadnought',        pts:435, tonnage:'C', groupSize:1, thrust:6,  scan:12, sig:14, hull:24, es:'3+', ks:'3+', bs:'5+', weapons:[W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-6400 Mass Driver Turret Battery','F/S',8,'3+',1,'K','Critical-1'),W('UF-6400 Mass Driver Turret Battery','F/S',8,'3+',1,'K','Critical-1'),W('UF-4200 Mass Driver Turrets','F/S',6,'4+',1,'K','Fusillade-3, Volley-2'),W('Leviathan Missile Bays','F/S/R',8,'3+',1,'K','Close Action')], special:'Aegis-6, Command Ship-2, Reinforced Armour' },
  'Washington Supercarrier':{ role:'Supercarrier',       pts:530, tonnage:'C', groupSize:1, thrust:6,  scan:12, sig:14, hull:24, es:'3+', ks:'3+', bs:'5+', weapons:[W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-4200 Mass Driver Turrets','F/S',6,'4+',1,'K','Fusillade-3, Volley-2'),W('Leviathan Missile Bays','F/S/R',8,'3+',1,'K','Close Action')], launch:[L('Fighters & Bombers',6,'fighter_bomber')], special:'Aegis-6, Command Ship-2, Reinforced Armour' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Tayne':      { role:'Famous Admiral (Heavy Cruiser)', pts:155, tonnage:'M', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:12, es:'4+', ks:'3+', bs:'6+', weapons:[W('Cobra Heavy Laser Pair','FN',6,'3+',1,'E','Burnthrough-2, Flash-2, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'Stressful Manoeuvre, Famous Admiral Lv2' },
  'Weaver':     { role:'Famous Admiral (Battlecruiser)', pts:210, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:14, es:'4+', ks:'3+', bs:'6+', weapons:[W('Viper Super Heavy Laser','FN',8,'3+',1,'E','Bloom-1, Burnthrough-1, Flash-1, Focused'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], special:'Vanguard-6", Jink, Famous Admiral Lv3', vanguard:6 },
  'Havelock':   { role:'Famous Admiral (Battleship)',    pts:330, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:20, es:'4+', ks:'3+', bs:'5+', weapons:[W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber'),L('Medium Torpedo',1,'torpedo')], special:'Spearhead, Famous Admiral Lv4' },
  '"Granite" Halsey': { role:'Famous Admiral (Supercarrier)', pts:635, tonnage:'C', groupSize:1, thrust:6, scan:12, sig:14, hull:24, es:'3+', ks:'3+', bs:'5+', weapons:[W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-9000 Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('UF-4200 Mass Driver Turret Core Battery','F/S',6,'4+',1,'K','Fusillade-3, Volley-2'),W('UF-4200 Mass Driver Turrets','F/S',4,'4+',1,'K','Fusillade-2, Volley-2'),W('Leviathan Missile Bays','F/S/R',8,'3+',1,'K','Close Action')], launch:[L('Fighters & Bombers',6,'fighter_bomber'),L('Heavy Bombers',4,'bomber')], special:'Aegis-6, Command Ship-2, Reinforced Armour, Fighter Command, Famous Admiral Lv5' },
};

// ── SCOURGE ───────────────────────────────────────────────────────────────────

const SCOURGE = {
  // ── Corvettes / Cutters ───────────────────────────────────────────────────
  'Nickar Hunter-Killer':   { role:'Corvette',           pts:20,  tonnage:'L', groupSize:1, thrust:16, scan:6,  sig:2,  hull:2,  es:'6+', ks:'6+', bs:'—', weapons:[W('Plasma Squall','F/S/R',3,'4+',1,'K','Air to Air, Close Action, Scald-2')], special:'Descent' },
  'Hiruko Boarding Cutter': { role:'Cutter',             pts:23,  tonnage:'L', groupSize:1, thrust:14, scan:6,  sig:2,  hull:2,  es:'6+', ks:'6+', bs:'—', weapons:[W('Plasma Torch','F',3,'4+',1,'E','Close Action, Scald-2, Sustained Fire')], launch:[L('Boarding Pods',1,'boarding_pod')], special:'Impetuous, Vanguard-7"', vanguard:7 },
  'Ebisu Tackling Cutter':  { role:'Cutter',             pts:23,  tonnage:'L', groupSize:1, thrust:14, scan:6,  sig:2,  hull:2,  es:'6+', ks:'6+', bs:'—', weapons:[W('Engine Needle','FN',2,'3+',1,'E','Crippling-Navigation Offline')], launch:[L('Boarding Pods',1,'boarding_pod')], special:'Impetuous, Rare, Vanguard-7"', vanguard:7 },
  // ── Frigates ──────────────────────────────────────────────────────────────
  'Harpy Frigate':          { role:'Frigate',            pts:40,  tonnage:'L', groupSize:2, thrust:12, scan:6,  sig:3,  hull:4,  es:'5+', ks:'5+', bs:'—', weapons:[W('Oculus Beams','F/S',2,'3+',2,'E','Scald-1')], special:'Descent' },
  'Djinn Frigate':          { role:'Frigate',            pts:44,  tonnage:'L', groupSize:2, thrust:12, scan:6,  sig:3,  hull:4,  es:'5+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Plasma Storm','F/S',4,'3+',1,'K','Close Action, Scald-2')], special:'Descent' },
  'Charybdis Frigate':      { role:'Frigate',            pts:34,  tonnage:'L', groupSize:2, thrust:12, scan:6,  sig:3,  hull:4,  es:'5+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Plasma Bombs','F/S',4,'5+',1,'K','Bombardment, Scald-2')], special:'Descent' },
  'Scylla Frigate':         { role:'Frigate',            pts:33,  tonnage:'L', groupSize:2, thrust:12, scan:6,  sig:3,  hull:4,  es:'5+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Reverse Grav Cannon','F/S',4,'3+',1,'K','Escape Velocity')], special:'Descent' },
  'Gargoyle Strike Carrier':{ role:'Strike Carrier',    pts:40,  tonnage:'L', groupSize:1, thrust:12, scan:6,  sig:3,  hull:4,  es:'5+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1')], launch:[L('Dropships',1,'dropship')], special:'Descent' },
  // ── Monitors / Barges ─────────────────────────────────────────────────────
  'Shedu Monitor':          { role:'Monitor',            pts:48,  tonnage:'L', groupSize:1, thrust:6,  scan:8,  sig:5,  hull:4,  es:'3+', ks:'4+', bs:'—', weapons:[W('Oculus Beam Crest','F',2,'3+',2,'E','Scald-2')], special:'Detector, Monitor' },
  'Lamassu Barge':          { role:'Barge',              pts:50,  tonnage:'L', groupSize:1, thrust:6,  scan:8,  sig:5,  hull:4,  es:'3+', ks:'4+', bs:'—', weapons:[W('Oculus Rays','F',1,'3+',1,'E','Scald-1'),W('Plasma Bombs','F/S',4,'5+',1,'K','Bombardment, Scald-2')], launch:[L('Bulk Landers',2,'bulk_lander')], special:'—' },
  'Apsasu Barge':           { role:'Barge',              pts:60,  tonnage:'L', groupSize:1, thrust:6,  scan:8,  sig:5,  hull:4,  es:'3+', ks:'4+', bs:'—', weapons:[W('Oculus Rays','F',1,'3+',1,'E','Scald-1'),W('Plasma Bombs','F/S',4,'5+',1,'K','Bombardment, Scald-2')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'—' },
  // ── Cutters / Destroyers ──────────────────────────────────────────────────
  'Wraith Cutter':          { role:'Cutter',             pts:48,  tonnage:'L', groupSize:1, thrust:16, scan:6,  sig:6,  hull:6,  es:'5+', ks:'6+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Plasma Brand','F',2,'3+',2,'K','Close Action, Crippling-Fire, Scald-2')], special:'Vectored' },
  'Incubus Destroyer':      { role:'Destroyer',          pts:50,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:5,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Furnace Blaster','FN',4,'3+',1,'E','Burnthrough-1, Crippling-Fire, Focused'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'—' },
  'Succubus Destroyer':     { role:'Destroyer',          pts:65,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:5,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Oculus Beams','F/S',1,'3+',2,'E','Scald-1'),W('Oculus Beams','F/S',1,'3+',2,'E','Scald-1'),W('Seekers','F/S/R',4,'3+',1,'E','Close Action, Re-Entry, Scald-2')], special:'—' },
  'Revenant Destroyer':     { role:'Destroyer',          pts:66,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:5,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Oculus Rays','F',2,'3+',1,'E','Scald-1'),W('Plasma Vortex','F/S/R',6,'3+',1,'K','Close Action, Scald-2')], launch:[L('Fighters & Bombers',1,'fighter_bomber')], special:'—' },
  // ── Light Cruisers ────────────────────────────────────────────────────────
  'Gremlin Light Cruiser':  { role:'Light Cruiser',      pts:72,  tonnage:'M', groupSize:1, thrust:12, scan:6,  sig:8,  hull:8,  es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Furnace Cannons','FN',6,'3+',1,'E','Burnthrough-1, Crippling-Fire, Focused')], special:'Vanguard-6"', vanguard:6 },
  'Strix Light Cruiser':    { role:'Light Cruiser',      pts:84,  tonnage:'M', groupSize:1, thrust:12, scan:6,  sig:8,  hull:8,  es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2')], special:'Vanguard-6"', vanguard:6 },
  'Yokai Light Cruiser':    { role:'Light Cruiser',      pts:80,  tonnage:'M', groupSize:1, thrust:12, scan:6,  sig:8,  hull:8,  es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Oculus Beam Array','F/S',4,'3+',2,'E','Scald-1')], special:'Vanguard-6"', vanguard:6 },
  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Ifrit Cruiser':          { role:'Cruiser',            pts:85,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:8,  hull:10, es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Furnace Cannons','FN',6,'3+',1,'E','Burnthrough-1, Crippling-Fire, Focused'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'—' },
  'Sphinx Cruiser':         { role:'Cruiser',            pts:90,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:8,  hull:10, es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Oculus Beam Array','F/S',4,'3+',2,'E','Scald-1'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'—' },
  'Wyvern Cruiser':         { role:'Cruiser',            pts:85,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:8,  hull:10, es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'—' },
  'Chimera Troopship':      { role:'Troopship',          pts:95,  tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:8,  hull:10, es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], launch:[L('Bulk Landers',4,'bulk_lander')], special:'—' },
  'Hydra Fleet Carrier':    { role:'Fleet Carrier',     pts:135, tonnage:'M', groupSize:1, thrust:10, scan:6,  sig:8,  hull:10, es:'4+', ks:'4+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], launch:[L('Fighters & Bombers',3,'fighter_bomber')], special:'Minelayer' },
  // ── Heavy Cruisers ────────────────────────────────────────────────────────
  'Raiju Heavy Cruiser':    { role:'Heavy Cruiser',      pts:125, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:8,  hull:12, es:'4+', ks:'3+', bs:'—', weapons:[W('Oculus Beam Crest','F/S',3,'3+',2,'E','Scald-2'),W('Furnace Cannons','FN',6,'3+',1,'E','Burnthrough-1, Crippling-Fire, Focused'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'Cloak-2, Stealth' },
  'Shenlong Heavy Cruiser': { role:'Heavy Cruiser',      pts:135, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:8,  hull:12, es:'4+', ks:'3+', bs:'—', weapons:[W('Oculus Beam Crest','F/S',3,'3+',2,'E','Scald-2'),W('Oculus Beam Array','F/S',4,'3+',2,'E','Scald-1'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'Cloak-2, Stealth' },
  'Kulshedra Heavy Carrier':{ role:'Heavy Carrier',      pts:164, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:8,  hull:12, es:'4+', ks:'3+', bs:'—', weapons:[W('Oculus Beams','F',1,'3+',2,'E','Scald-1'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'—' },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Akuma Battlecruiser':    { role:'Battlecruiser',      pts:170, tonnage:'H', groupSize:1, thrust:10, scan:6,  sig:8,  hull:14, es:'4+', ks:'4+', bs:'6+', weapons:[W('Oculus Beam Array','F',2,'3+',2,'E','Scald-1'),W('Oculus Beam Phalanx','F/S',3,'3+',2,'E','Scald-1, Volley-2')], special:'Cloak-1, Stealth, Vanguard-6"', vanguard:6 },
  'Banshee Battlecruiser':  { role:'Battlecruiser',      pts:170, tonnage:'H', groupSize:1, thrust:10, scan:6,  sig:8,  hull:14, es:'4+', ks:'4+', bs:'6+', weapons:[W('Oculus Beam Array','F',2,'3+',2,'E','Scald-1'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2')], launch:[L('Torpedo',1,'torpedo')], special:'Cloak-1, Stealth, Vanguard-6"', vanguard:6 },
  'Shadow Battlecruiser':   { role:'Battlecruiser',      pts:220, tonnage:'H', groupSize:1, thrust:10, scan:6,  sig:8,  hull:14, es:'4+', ks:'4+', bs:'6+', weapons:[W('Oculus Beam Array','F',2,'3+',2,'E','Scald-1'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Vanguard-6"', vanguard:6 },
  // ── Battleships ───────────────────────────────────────────────────────────
  'Daemon Battleship':      { role:'Battleship',         pts:215, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:10, hull:20, es:'3+', ks:'4+', bs:'5+', weapons:[W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1'),W('Oculus Beam Phalanx','F/S',4,'3+',2,'E','Scald-1, Volley-2'),W('Furnace Fangs','FN',6,'2+',1,'E','Burnthrough-1, Crippling-Fire, Focused')], special:'—' },
  'Dragon Battleship':      { role:'Battleship',         pts:245, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:10, hull:20, es:'3+', ks:'4+', bs:'5+', weapons:[W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1'),W('Furnace Fangs','FN',6,'2+',1,'E','Burnthrough-1, Crippling-Fire, Focused')], launch:[L('Fighters & Bombers',3,'fighter_bomber')], special:'—' },
  'Beelzebub Battleship':   { role:'Battleship',         pts:255, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:10, hull:20, es:'3+', ks:'4+', bs:'5+', weapons:[W('Mega Plasma Lance Battery','F/S',3,'3+',2,'E','Calibre-H/C, Reave-2, Volley-2'),W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1'),W('Furnace Fangs','FN',6,'2+',1,'E','Burnthrough-1, Crippling-Fire, Focused')], launch:[L('Fighters & Bombers',3,'fighter_bomber')], special:'—' },
  'Lucifer Battleship':     { role:'Battleship',         pts:205, tonnage:'H', groupSize:1, thrust:11, scan:8,  sig:10, hull:20, es:'3+', ks:'4+', bs:'5+', weapons:[W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1')], launch:[L('Fighters & Bombers',5,'fighter_bomber')], special:'—' },
  // ── Dreadnoughts ─────────────────────────────────────────────────────────
  'Nosferatu Dreadnought':  { role:'Dreadnought',        pts:490, tonnage:'C', groupSize:1, thrust:8,  scan:10, sig:14, hull:24, es:'3+', ks:'2+', bs:'5+', weapons:[W('Oculus Beam Super Phalanx','F',8,'3+',2,'E','Scald-2'),W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1, Volley-2'),W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1, Volley-2'),W('Plasma Flood','F/S',9,'3+',1,'K','Close Action, Scald-2')], launch:[L('Fighters & Bombers',6,'fighter_bomber')], special:'Cloak-1, Stealth' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Enslaver':    { role:'Famous Admiral (Heavy Cruiser)', pts:170, tonnage:'M', groupSize:1, thrust:8,  scan:6,  sig:8,  hull:12, es:'4+', ks:'3+', bs:'—', weapons:[W('Oculus Beam Crest','F/S',3,'3+',2,'E','Scald-2'),W('Furnace Cannons','FN',4,'2+',1,'E','Burnthrough-1, Crippling-Fire, Focused'),W('Plasma Gale','F/S',3,'3+',1,'K','Close Action, Scald-2')], special:'Cloak-2, Stealth, Savagery, Famous Admiral Lv2' },
  'Flayer':      { role:'Famous Admiral (Battlecruiser)', pts:285, tonnage:'H', groupSize:1, thrust:10, scan:6,  sig:8,  hull:14, es:'4+', ks:'4+', bs:'6+', weapons:[W('Oculus Beam Array','F',2,'3+',2,'E','Scald-1'),W('Magneton Lash','FN',4,'*',2,'E','Calibre-H/C, Close Action, Mauler, Penetrator'),W('Plasma Tempest','F/S',8,'3+',1,'K','Close Action, Fusillade-2, Scald-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Vanguard-7", Death Mistress, Famous Admiral Lv3', vanguard:7 },
  'Baba Yaga':   { role:'Famous Admiral (Battleship)',    pts:265, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:10, hull:20, es:'3+', ks:'4+', bs:'5+', weapons:[W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1'),W('Oculus Beam Phalanx','F/S',4,'3+',2,'E','Scald-1, Volley-2'),W('Furnace Fangs','FN',6,'2+',1,'E','Burnthrough-1, Crippling-Fire, Focused')], special:'Winged Bulwark, Famous Admiral Lv2' },
  'Overlord of Flies': { role:'Famous Admiral (Dreadnought)', pts:575, tonnage:'C', groupSize:1, thrust:8, scan:10, sig:14, hull:24, es:'3+', ks:'2+', bs:'4+', weapons:[W('Oculus Beam Super Phalanx','F',8,'3+',2,'E','Scald-2'),W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1, Volley-2'),W('Oculus Beam Array','F/S',3,'3+',2,'E','Scald-1, Volley-2'),W('Plasma Flood','F/S',9,'3+',1,'K','Close Action, Scald-2')], launch:[L('Fighters & Bombers',8,'fighter_bomber')], special:'Cloak-1, Stealth, Doomed, Famous Admiral Lv4' },
};

// ── PHR ───────────────────────────────────────────────────────────────────────

const PHR = {
  // ── Corvettes / Lighters ──────────────────────────────────────────────────
  'Echo':                   { role:'Corvette',           pts:28,  tonnage:'L', groupSize:1, thrust:12, scan:8,  sig:2,  hull:2,  es:'4+', ks:'6+', bs:'—', weapons:[W('Medium Calibre Turret','F',1,'4+',2,'K','—'),W('Vespa Drones','F/S/R',3,'4+',1,'K','Air to Air, Close Action')], special:'Descent, Stealth' },
  'Harpocrates':            { role:'Guerilla Lighter',   pts:20,  tonnage:'L', groupSize:1, thrust:10, scan:6,  sig:2,  hull:2,  es:'5+', ks:'6+', bs:'—', weapons:[W('EM Warfare Suite','F/S',2,'3+',1,'E','Crippling-Weapons Offline')], special:'Descent' },
  // ── Frigates / Monitors / Carriers ───────────────────────────────────────
  'Europa':                 { role:'Frigate',            pts:38,  tonnage:'L', groupSize:2, thrust:10, scan:8,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('Medium Calibre Bank','SL',2,'4+',2,'K','—'),W('Medium Calibre Bank','SR',2,'4+',2,'K','—')], special:'—' },
  'Pandora':                { role:'Frigate',            pts:42,  tonnage:'L', groupSize:2, thrust:10, scan:8,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('Supernova Laser','FN',3,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], special:'—' },
  'Calypso':                { role:'Frigate',            pts:40,  tonnage:'L', groupSize:1, thrust:10, scan:8,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('Wasp Drones','F/S/R',3,'3+',1,'K','Close Action')], special:'Rare, Advanced ECM Suite' },
  'Andromeda':              { role:'Escort Carrier',     pts:60,  tonnage:'L', groupSize:2, thrust:10, scan:8,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('Wasp Drones','F/S/R',3,'3+',1,'K','Close Action')], launch:[L('Fighters & Bombers',1,'fighter_bomber')], special:'Escort' },
  'Medea':                  { role:'Strike Carrier',    pts:50,  tonnage:'L', groupSize:1, thrust:10, scan:8,  sig:3,  hull:5,  es:'3+', ks:'4+', bs:'—', weapons:[W('Bombardment Turret','F/S',3,'5+',1,'K','Bombardment')], launch:[L('Dropships',1,'dropship')], special:'Descent' },
  'Castor':                 { role:'Monitor',            pts:55,  tonnage:'L', groupSize:1, thrust:5,  scan:10, sig:4,  hull:5,  es:'2+', ks:'4+', bs:'—', weapons:[W('Quad Battery','F',2,'3+',2,'K','Critical-1, Fusillade-2')], special:'Monitor' },
  'Pollux':                 { role:'Escort Frigate',    pts:65,  tonnage:'L', groupSize:1, thrust:8,  scan:8,  sig:4,  hull:5,  es:'2+', ks:'4+', bs:'—', weapons:[W('Wasp Drones','F/S/R',3,'3+',1,'K','Close Action'),W('Point Defence Array','F/S/R',3,'3+',1,'E','Anti-Wing, Close Action, Fusillade-1')], special:'Aegis-2, Escort' },
  'Philonoe':               { role:'Torpedo Monitor',   pts:65,  tonnage:'L', groupSize:1, thrust:5,  scan:10, sig:4,  hull:5,  es:'2+', ks:'4+', bs:'—', weapons:[W('Wasp Drones','F/S/R',3,'3+',1,'K','Close Action')], launch:[L('Torpedo',3,'torpedo')], special:'Monitor, Catapult Launcher' },
  'Pegasus':                { role:'Cutter',             pts:58,  tonnage:'L', groupSize:1, thrust:14, scan:6,  sig:3,  hull:5,  es:'4+', ks:'5+', bs:'—', weapons:[W('Nano Drones','F/S',8,'4+',1,'K','Close Action')], special:'Regenerate-4' },
  'Ourania':                { role:'Swiftlink',          pts:35,  tonnage:'L', groupSize:1, thrust:14, scan:6,  sig:3,  hull:5,  es:'4+', ks:'5+', bs:'—', weapons:[], special:'Rare, Targeting Link' },
  'Chrysaor':               { role:'Cutter',             pts:40,  tonnage:'L', groupSize:2, thrust:14, scan:6,  sig:3,  hull:5,  es:'4+', ks:'5+', bs:'—', weapons:[W('Long Heavy Calibres','FN',1,'3+',3,'K','Calibre-H/C, Penetrator')], special:'—' },
  // ── Destroyers / Cutters / Blockade Runners ───────────────────────────────
  'Electra':                { role:'Destroyer',          pts:50,  tonnage:'L', groupSize:2, thrust:8,  scan:8,  sig:4,  hull:7,  es:'3+', ks:'5+', bs:'—', weapons:[W('Twin Heavy Calibres','F',1,'4+',3,'K','Calibre-H/C, Penetrator'),W('Twin Heavy Calibres','F',1,'4+',3,'K','Calibre-H/C, Penetrator')], special:'—' },
  'Ariadne':                { role:'Destroyer',          pts:60,  tonnage:'L', groupSize:1, thrust:8,  scan:8,  sig:4,  hull:7,  es:'3+', ks:'5+', bs:'—', weapons:[W('Twin Heavy Calibres','F',1,'4+',3,'K','Calibre-H/C, Penetrator')], launch:[L('Bulk Landers',2,'bulk_lander')], special:'—' },
  'Cadmus':                 { role:'Destroyer',          pts:60,  tonnage:'L', groupSize:2, thrust:8,  scan:8,  sig:4,  hull:7,  es:'3+', ks:'5+', bs:'—', weapons:[W('Twin Heavy Calibres','F',1,'4+',3,'K','Calibre-H/C, Penetrator'),W('Energy Glaive Pair','FN',2,'3+',2,'E','Overcharge')], special:'—' },
  'Jason':                  { role:'Blockade Runner',   pts:55,  tonnage:'L', groupSize:1, thrust:12, scan:8,  sig:2,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Twin Heavy Calibres','F',1,'4+',3,'K','Calibre-H/C, Penetrator'),W('Kingfisher Drones','F/S/R',5,'3+',1,'K','Close Action, Re-Entry')], special:'Rare' },
  'Odysseus':               { role:'Blockade Runner',   pts:63,  tonnage:'L', groupSize:1, thrust:12, scan:8,  sig:2,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Kingfisher Drones','F/S/R',5,'3+',1,'K','Close Action, Re-Entry')], launch:[L('Bulk Landers',2,'bulk_lander')], special:'Rare' },
  'Meleager':               { role:'Blockade Runner',   pts:55,  tonnage:'L', groupSize:1, thrust:12, scan:8,  sig:2,  hull:6,  es:'4+', ks:'5+', bs:'—', weapons:[W('Kingfisher Drones','F/S/R',5,'3+',1,'K','Close Action, Re-Entry'),W('Energy Glaive Pair','FN',2,'3+',2,'E','Overcharge')], special:'Rare' },
  // ── Light Cruisers ────────────────────────────────────────────────────────
  'Theseus':                { role:'Light Cruiser',      pts:88,  tonnage:'M', groupSize:1, thrust:10, scan:8,  sig:6,  hull:9,  es:'3+', ks:'4+', bs:'—', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2')], special:'—' },
  'Otera':                  { role:'Light Cruiser',      pts:80,  tonnage:'M', groupSize:1, thrust:10, scan:8,  sig:6,  hull:9,  es:'3+', ks:'4+', bs:'—', weapons:[W('Bombardment Battery','F/S/R',8,'5+',1,'K','Bombardment'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2')], special:'—' },
  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Ajax':                   { role:'Cruiser',            pts:114, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:11, es:'3+', ks:'4+', bs:'—', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Supernova Laser','FN',3,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], special:'—' },
  'Perseus':                { role:'Cruiser',            pts:108, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:11, es:'3+', ks:'4+', bs:'—', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2'),W('Medium Calibre Turret','F',1,'4+',2,'K','—')], special:'—' },
  'Orion':                  { role:'Cruiser',            pts:105, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:11, es:'3+', ks:'4+', bs:'—', weapons:[W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Turret','F',1,'4+',2,'K','—')], special:'—' },
  'Ikarus':                 { role:'Vanguard Carrier',   pts:125, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:11, es:'3+', ks:'4+', bs:'—', weapons:[W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Turret','F',1,'4+',2,'K','—')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-4"', vanguard:4 },
  'Teucer':                 { role:'Cruiser',            pts:130, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:11, es:'3+', ks:'4+', bs:'—', weapons:[W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2'),W('Supernova Laser','FN',3,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], special:'—' },
  // ── Heavy Cruisers ────────────────────────────────────────────────────────
  'Achilles':               { role:'Heavy Cruiser',      pts:142, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2'),W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'—' },
  'Bellerophon':            { role:'Heavy Cruiser',      pts:185, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Twin Supernova Laser','FN',3,'3+',2,'E','Burnthrough-2, Flash-2, Focused')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'—' },
  'Hector':                 { role:'Heavy Cruiser',      pts:134, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Twin Supernova Laser','FN',3,'3+',2,'E','Burnthrough-2, Flash-2, Focused')], special:'—' },
  'Sysyphus':               { role:'Heavy Cruiser',      pts:122, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Bombardment Battery','F/S/R',8,'5+',1,'K','Bombardment'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'—' },
  'Orpheus':                { role:'Assault Troopship',  pts:170, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-entry, Volley-2'),W('Supernova Laser','FN',3,'3+',1,'E','Burnthrough-1, Flash-1, Focused')], launch:[L('Bulk Landers',4,'bulk_lander')], special:'—' },
  'Ganymede':               { role:'Assault Troopship',  pts:165, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Bombardment Battery','F/S/R',8,'5+',1,'K','Bombardment'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Turret','F',1,'4+',2,'K','—')], launch:[L('Bulk Landers',4,'bulk_lander')], special:'—' },
  // ── Supercruisers ─────────────────────────────────────────────────────────
  'Ptolemy':                { role:'Supercruiser',       pts:174, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:14, es:'3+', ks:'4+', bs:'6+', weapons:[W('Hornet Drone Cluster','F/S/R',8,'3+',2,'K','Close Action'),W('Light Calibre Double Broadside','B',12,'5+',1,'K','Calibre-L, Re-Entry, Volley-2')], special:'Feature Carrier' },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Agamemnon':              { role:'Battlecruiser',      pts:160, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'6+', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-Entry, Volley-2'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-Entry, Volley-2'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2'),W('Medium Calibre Broadside','B',3,'4+',2,'K','Fusillade-1, Volley-2')], special:'Vanguard-4"', vanguard:4 },
  'Priam':                  { role:'Battlecruiser',      pts:195, tonnage:'H', groupSize:1, thrust:8,  scan:8,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'6+', weapons:[W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-Entry, Volley-2'),W('Light Calibre Broadside','B',6,'5+',1,'K','Calibre-L, Re-Entry, Volley-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Vanguard-4"', vanguard:4 },
  'Pompeius':               { role:'Battlecruiser',      pts:140, tonnage:'H', groupSize:1, thrust:10, scan:8,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'6+', weapons:[W('Heavy Quad Battery','F',4,'3+',2,'K','Critical-1, Calibre-H/C, Penetrator')], special:'Vanguard-4"', vanguard:4 },
  // ── Battleships ───────────────────────────────────────────────────────────
  'Heracles':               { role:'Battleship',         pts:235, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Heavy Calibre Triple Broadside','B',3,'3+',3,'K','Calibre-H/C, Penetrator, Volley-2'),W('Dark Matter Cannon','FN',4,'2+',2,'E','Critical-1, Crippling, Penetrator')], special:'—' },
  'Minos':                  { role:'Battleship',         pts:255, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Heavy Calibre Triple Broadside','B',3,'3+',3,'K','Calibre-H/C, Penetrator, Volley-2'),W('Neutron Missiles','F/S',4,'2+',2,'E','Close Action, Crippling, Penetrator')], launch:[L('Torpedo',2,'torpedo')], special:'—' },
  'Sarpedon':               { role:'Battleship',         pts:235, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Meganova Laser','FN',3,'3+',2,'E','Penetrator, Flash-2, Focused, Volley-2'),W('Laser Multi-Lance','F',7,'4+',1,'E','Calibre-L, Reave-1, Volley-2')], special:'—' },
  // ── Dreadnoughts ─────────────────────────────────────────────────────────
  'Romulus':                { role:'Dreadnought',        pts:450, tonnage:'C', groupSize:1, thrust:6,  scan:12, sig:14, hull:25, es:'2+', ks:'3+', bs:'5+', weapons:[W('Hypernova Laser','FN',3,'3+',3,'C','Critical-1, Focused'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2')], special:'Reinforced Armour' },
  'Remus':                  { role:'Dreadnought',        pts:455, tonnage:'C', groupSize:1, thrust:6,  scan:12, sig:14, hull:25, es:'2+', ks:'3+', bs:'5+', weapons:[W('Apocalypse Cannon','FN',4,'4+',2,'C','Bombardment, Overcharge'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Hornet Drone Hive','F/S/R',6,'3+',2,'K','Close Action')], launch:[L('Torpedo',4,'torpedo')], special:'Reinforced Armour' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Javelin':          { role:'Famous Admiral (Heavy Cruiser)', pts:207, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2'),W('Heavy Calibre Broadside','B',1,'3+',3,'K','Calibre-H, Penetrator, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'Regenerate-2, Reinforced Armour, Self Repairing Armour Systems, Famous Admiral Lv3' },
  'Helena of Asgard': { role:'Famous Admiral (Battlecruiser)', pts:200, tonnage:'H', groupSize:1, thrust:10, scan:8,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'6+', weapons:[W('Heavy Quad Battery (Anti-Capital)','F',4,'3+',2,'K','Alt-1, Calibre-H/C, Critical-1, Penetrator'),W('Heavy Quad Battery (Flak)','F',12,'2+',1,'K','Alt-1, Fusillade-4')], special:'Vanguard-4", Cull the Weak, Famous Admiral Lv2', vanguard:4 },
  'Claudia Rhee':     { role:'Famous Admiral (Battleship)',    pts:310, tonnage:'H', groupSize:1, thrust:6,  scan:10, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Heavy Calibre Triple Broadside','B',3,'3+',3,'K','Calibre-H/C, Penetrator, Volley-2'),W('Dark Matter Cannon','FN',4,'2+',2,'E','Crippling, Critical-1, Penetrator'),W('Hornet Drones','F/S/R',5,'3+',1,'K','Close Action')], special:'Famous Admiral Lv4' },
  'Gaius Chau':       { role:'Famous Admiral (Dreadnought)',   pts:555, tonnage:'C', groupSize:1, thrust:6,  scan:12, sig:14, hull:25, es:'2+', ks:'3+', bs:'5+', weapons:[W('Hypernova Laser','FN',3,'3+',3,'C','Critical-1, Focused'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2'),W('Energy Glaive Battery','B',6,'3+',2,'E','Overcharge, Volley-2')], special:'Reinforced Armour, Cutting Power, Famous Admiral Lv5' },
};

// ── SHALTARI ──────────────────────────────────────────────────────────────────

const SHALTARI = {
  // ── Voidgates / Cloudflyers / Voidflyers ──────────────────────────────────
  'Voidgate':               { role:'Voidgate',           pts:15,  tonnage:'L', groupSize:1, thrust:12, scan:2,  sig:2,  hull:3,  es:'5+', ks:'5+', bs:'—', weapons:[], openNetwork:true, gateship:2, special:'Descent, Gateship-2, Shield-5+, Open Network' },
  'Glass':                  { role:'Cloudflyer',         pts:20,  tonnage:'L', groupSize:2, thrust:16, scan:8,  sig:1,  hull:1,  es:'5+', ks:'5+', bs:'—', weapons:[W('Ion Lance','F',5,'4+',1,'E','Air to Air, Close Action')], special:'Descent, Shield-5+' },
  'Helium':                 { role:'Voidflyer',          pts:29,  tonnage:'L', groupSize:1, thrust:16, scan:8,  sig:1,  hull:2,  es:'6+', ks:'6+', bs:'—', weapons:[W('Pulse Blaster','F/S',1,'3+',2,'E','Close Action, Penetrator')], special:'Descent, Shield-5+, Vectored, Void Skip' },
  // ── Frigates ──────────────────────────────────────────────────────────────
  'Topaz':                  { role:'Frigate',            pts:43,  tonnage:'L', groupSize:2, thrust:12, scan:10, sig:4,  hull:4,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disintegrator Bank','F',3,'3+',1,'E','Reave-1')], special:'Shield-5+, Vanguard-4"', vanguard:4 },
  'Jade':                   { role:'Frigate',            pts:50,  tonnage:'L', groupSize:2, thrust:12, scan:10, sig:4,  hull:4,  es:'5+', ks:'4+', bs:'—', weapons:[W('Particle Lance','FN',1,'3+',2,'C','—')], special:'Shield-5+, Vanguard-4"', vanguard:4 },
  'Opal':                   { role:'Shielding Frigate',  pts:45,  tonnage:'L', groupSize:1, thrust:12, scan:10, sig:4,  hull:4,  es:'5+', ks:'4+', bs:'—', weapons:[W('Harpoon Strike','F/S/R',2,'4+',1,'K','Close Action')], special:'Shield-5+, Vanguard-4", Shield Booster', vanguard:4 },
  'Amethyst':               { role:'Frigate',            pts:43,  tonnage:'L', groupSize:2, thrust:12, scan:10, sig:4,  hull:4,  es:'5+', ks:'4+', bs:'—', weapons:[W('Microwave Array','F/S/R',4,'3+',1,'E','Close Action, Scald-1')], special:'Shield-5+, Vanguard-4"', vanguard:4 },
  // ── Monitors ──────────────────────────────────────────────────────────────
  'Silicon':                { role:'Monitor',            pts:55,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:6,  hull:4,  es:'4+', ks:'4+', bs:'—', weapons:[W('Quad Ion Cannon','F',2,'3+',2,'E','Crippling-Navigation Offline')], special:'Monitor, Shield-4+' },
  'Selenium':               { role:'Heavy Voidgate',     pts:55,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:6,  hull:4,  es:'4+', ks:'4+', bs:'—', weapons:[W('Defence Array','F/S/R',4,'4+',1,'E','Escape Velocity'),W('Charged Air','F/S/R',3,'5+',1,'E','Air to Air, Close Action')], openNetwork:true, gateship:3, special:'Descent, Gateship-3, Shield-4+' },
  'Strontium':              { role:'Monitor',            pts:58,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:6,  hull:4,  es:'4+', ks:'4+', bs:'—', weapons:[W('Force Projectors','F/S',6,'3+',1,'K','Anti Wing, Close Action')], special:'Monitor, Shield-4+' },
  // ── Cutters ───────────────────────────────────────────────────────────────
  'Caesium':                { role:'Cutter',             pts:50,  tonnage:'L', groupSize:1, thrust:20, scan:8,  sig:6,  hull:3,  es:'6+', ks:'4+', bs:'—', weapons:[W('Light Disruptor','FN',3,'3+',1,'E','Calibre-L')], special:'Shield-5+, Vanguard-4", Vectored', vanguard:4 },
  'Gallium':                { role:'Cutter',             pts:60,  tonnage:'L', groupSize:1, thrust:20, scan:8,  sig:6,  hull:3,  es:'6+', ks:'4+', bs:'—', weapons:[W('Bio Atomiser Array','F',3,'3+',1,'C','Close Action')], special:'Shield-5+, Vanguard-4", Vectored', vanguard:4 },
  // ── Destroyers ────────────────────────────────────────────────────────────
  'Chromium':               { role:'Destroyer',          pts:60,  tonnage:'L', groupSize:1, thrust:12, scan:12, sig:6,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruption Beamers','F',2,'3+',1,'E','Fusillade-1'),W('Thermal Lance Cannon','FN',2,'2+',1,'E','Burnthrough-1, Fusillade-1')], special:'Shield-5+' },
  'Iridium':                { role:'Destroyer',          pts:60,  tonnage:'L', groupSize:1, thrust:12, scan:12, sig:6,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruption Beamers','F',2,'3+',1,'E','Fusillade-1'),W('Kinetic Lance','FN',2,'3+',2,'K','Status')], special:'Shield-5+' },
  'Mercury':                { role:'Destroyer',          pts:60,  tonnage:'L', groupSize:1, thrust:12, scan:12, sig:6,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruption Beamers','F',2,'3+',1,'E','Fusillade-1'),W('Pulse Ioniser Bank','F',4,'*',1,'E','Burnthrough-2, Calibre-H/C, Close Action, Mauler')], special:'Shield-5+' },
  // ── Homeships ─────────────────────────────────────────────────────────────
  'Cobalt':                 { role:'Homeship',           pts:56,  tonnage:'L', groupSize:1, thrust:12, scan:12, sig:6,  hull:5,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruption Beamers','F',2,'3+',1,'E','Fusillade-1')], launch:[L('Dropships',2,'gate_dropship')], special:'Shield-5+, Mothership' },
  // ── Light Cruisers ────────────────────────────────────────────────────────
  'Aquamarine':             { role:'Light Cruiser',      pts:74,  tonnage:'M', groupSize:2, thrust:12, scan:12, sig:6,  hull:7,  es:'5+', ks:'4+', bs:'—', weapons:[W('Gravity Coil Pair','FN',3,'2+',1,'E','Impel-2'),W('Harpoon Cascade','F/S/R',3,'4+',1,'K','Close Action')], special:'Shield-5+, Vanguard-6", Vectored', vanguard:6 },
  'Azurite':                { role:'Light Cruiser',      pts:76,  tonnage:'M', groupSize:2, thrust:12, scan:12, sig:6,  hull:7,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruptor Pair','FN',8,'4+',1,'E','—'),W('Harpoon Cascade','F/S/R',3,'4+',1,'K','Close Action')], special:'Shield-5+, Vanguard-6", Vectored', vanguard:6 },
  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Amber':                  { role:'Cruiser',            pts:100, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], special:'Shield-5+' },
  'Granite':                { role:'Cruiser',            pts:115, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Particle Lance','FN',1,'3+',2,'C','Critical-1'),W('Particle Lance','FN',1,'3+',2,'C','Critical-1')], special:'Shield-5+' },
  'Turquoise':              { role:'Cruiser',            pts:90,  tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Ion Aura','F/S/R',6,'3+',1,'E','Close Action, Scald-1'),W('Ion Storm','F/S/R',6,'4+',1,'E','Bombardment, Scald-1')], special:'Shield-5+' },
  'Basalt':                 { role:'Fleet Carrier',     pts:108, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruptor Pair','FN',8,'4+',1,'E','—')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Shield-5+' },
  'Emerald':                { role:'Mothership',         pts:115, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disruptor Pair','FN',8,'4+',1,'E','—')], launch:[L('Dropships',4,'gate_dropship')], special:'Mothership, Shield-5+' },
  'Citrine':                { role:'Mothership',         pts:130, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], launch:[L('Dropships',4,'gate_dropship')], special:'Mothership, Shield-5+' },
  // ── Heavy Cruisers ────────────────────────────────────────────────────────
  'Jet':                    { role:'Heavy Cruiser',      pts:115, tonnage:'M', groupSize:1, thrust:8,  scan:12, sig:6,  hull:11, es:'5+', ks:'4+', bs:'—', weapons:[W('Ion Aura','F/S/R',6,'3+',1,'E','Close Action, Scald-1'),W('Ion Storm','F/S/R',6,'4+',1,'E','Bombardment, Scald-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], special:'Shield-4+' },
  'Obsidian':               { role:'Heavy Cruiser',      pts:135, tonnage:'M', groupSize:1, thrust:8,  scan:12, sig:6,  hull:11, es:'5+', ks:'4+', bs:'—', weapons:[W('Particle Lance','FN',1,'3+',2,'C','Critical-1'),W('Particle Lance','FN',1,'3+',2,'C','Critical-1'),W('Particle Lance','FN',1,'3+',2,'C','Critical-1')], special:'Shield-4+' },
  'Onyx':                   { role:'Heavy Cruiser',      pts:125, tonnage:'M', groupSize:1, thrust:8,  scan:12, sig:6,  hull:11, es:'5+', ks:'4+', bs:'—', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], special:'Shield-4+' },
  'Scoria':                 { role:'Heavy Cruiser',      pts:175, tonnage:'M', groupSize:1, thrust:8,  scan:12, sig:6,  hull:11, es:'5+', ks:'4+', bs:'—', weapons:[W('Particle Lance','FN',1,'3+',2,'C','Critical-1'),W('Particle Lance','FN',1,'3+',2,'C','Critical-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Shield-4+' },
  // ── Supercruisers ─────────────────────────────────────────────────────────
  'Mesolite':               { role:'Supercruiser',       pts:180, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:12, es:'5+', ks:'4+', bs:'6+', weapons:[W('Twin Hyperwave Cannon','F',4,'3+',2,'E','Crippling-2xFire')], special:'Shield-4+, Feature Carrier' },
  'Natrolite':              { role:'Supercruiser',       pts:184, tonnage:'M', groupSize:1, thrust:10, scan:12, sig:6,  hull:12, es:'5+', ks:'4+', bs:'6+', weapons:[W('Disintegrator Battery Pair','F/S',5,'3+',1,'E','Volley-2, Reave-1')], special:'Shield-4+, Feature Carrier' },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Ruby':                   { role:'Battlecruiser',      pts:160, tonnage:'H', groupSize:1, thrust:10, scan:12, sig:6,  hull:13, es:'5+', ks:'4+', bs:'6+', weapons:[W('Disintegrator Battery Pair','F/S',5,'3+',1,'E','Volley-2, Reave-1'),W('Particle Lance Pair','FN',2,'3+',2,'C','Critical-1')], special:'Shield-4+, Vanguard-6"', vanguard:6 },
  'Sapphire':               { role:'Battlecruiser',      pts:150, tonnage:'H', groupSize:1, thrust:10, scan:12, sig:6,  hull:13, es:'5+', ks:'4+', bs:'6+', weapons:[W('Ion Aura','F/S/R',6,'3+',1,'E','Close Action, Scald-1'),W('Ion Storm','F/S/R',6,'4+',1,'E','Bombardment, Scald-1'),W('Gravity Coil Pair','FN',3,'2+',1,'E','Impel-2')], special:'Shield-4+, Vanguard-6"', vanguard:6 },
  'Hematite':               { role:'Battlecruiser',      pts:175, tonnage:'H', groupSize:1, thrust:10, scan:12, sig:6,  hull:13, es:'5+', ks:'4+', bs:'6+', weapons:[W('Quad Thermal Lance Cannon','FN',8,'2+',1,'E','Burnthrough-1, Bloom-1, Fusillade-4')], special:'Shield-4+, Vanguard-6"', vanguard:6 },
  'Goethite':               { role:'Battlecruiser',      pts:210, tonnage:'H', groupSize:1, thrust:10, scan:12, sig:6,  hull:13, es:'5+', ks:'4+', bs:'6+', weapons:[W('Twin Hyperwave Cannon','F',4,'3+',2,'E','Crippling-2xFire')], launch:[L('Fighters & Bombers',3,'fighter_bomber')], special:'Shield-4+, Vanguard-6"', vanguard:6 },
  // ── Pocket Battleships ────────────────────────────────────────────────────
  'Spinel':                 { role:'Pocket Battleships',  pts:225, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:6,  hull:14, es:'5+', ks:'4+', bs:'5+', weapons:[W('Particle Lance Pair','FN',2,'3+',2,'C','Critical-1'),W('Twin Hyperwave Cannon','F',4,'3+',2,'E','Crippling-2xFire')], special:'Shield-4+, Feature Carrier' },
  'Painite':                { role:'Pocket Battleships',  pts:190, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:6,  hull:14, es:'5+', ks:'4+', bs:'5+', weapons:[W('Disintegrator Battery Pair','F/S',5,'3+',1,'E','Volley-2, Reave-1'),W('Ion Aura','F/S/R',6,'3+',1,'E','Close Action, Scald-1'),W('Ion Storm','F/S/R',6,'4+',1,'E','Bombardment, Scald-1')], special:'Shield-4+, Feature Carrier' },
  // ── Battleships / Supercarriers ───────────────────────────────────────────
  'Diamond':                { role:'Battleship',         pts:230, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Particle Lance Triad','FN',3,'3+',2,'C','Critical-1')], launch:[L('Dropships',1,'gate_dropship')], special:'Mothership, Shield-4+' },
  'Platinum':               { role:'Supercarrier',       pts:280, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Harpoon Deluge','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Fighters & Bombers',5,'fighter_bomber')], special:'Mothership, Shield-4+' },
  'Gold':                   { role:'Supercarrier',       pts:285, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Ion Cannonade','F',10,'4+',1,'E','Crippling-Navigation Offline'),W('Microwave Array Bank','S',4,'3+',1,'E','Close Action, Scald-1, Volley-2')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Shield-4+' },
  'Silver':                 { role:'Battleship',         pts:250, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Obliterator Cannon','F',4,'3+',2,'C','Bloom-2, Critical-1, Focused'),W('Microwave Array Bank','S',4,'3+',1,'E','Close Action, Scald-1, Volley-2'),W('Gravitic Beamer','F/S',5,'4+',1,'E','Impel-1, Re-Entry')], special:'Shield-4+' },
  'Bronze':                 { role:'Battleship',         pts:230, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Ion Cannonade','F',10,'4+',1,'E','Crippling-Navigation Offline'),W('Microwave Array Bank','S',4,'3+',1,'E','Close Action, Scald-1, Volley-2'),W('Gravitic Beamer','F/S',5,'4+',1,'E','Impel-1, Re-Entry')], special:'Shield-4+' },
  'Copper':                 { role:'Battleship',         pts:200, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Mega Thermal Lance Cannon','FN',5,'2+',2,'E','Burnthrough-1, Bloom-2'),W('Microwave Array Bank','S',4,'3+',1,'E','Close Action, Scald-1, Volley-2')], special:'Shield-4+' },
  'Actinium':               { role:'Battleship',         pts:245, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Gravitic Beamer','F/S',5,'4+',1,'E','Impel-1, Re-Entry'),W('Electrosurge Projectors','B',3,'4+',1,'E','Status, Volley-2')], special:'Shield-4+' },
  // ── Super Battleships ─────────────────────────────────────────────────────
  'Lanthanum':              { role:'Super Battleship',   pts:265, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Particle Lance Triad','FN',3,'3+',2,'C','Critical-1'),W('Mega Thermal Lance Cannon','FN',5,'2+',2,'E','Burnthrough-1, Bloom-2'),W('Electrosurge Projectors','B',3,'4+',1,'E','Status, Volley-2')], special:'Shield-4+' },
  'Cerium':                 { role:'Super Battleship',   pts:230, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Mega Thermal Lance Cannon','FN',5,'2+',2,'E','Burnthrough-1, Bloom-2'),W('Microwave Array Bank','S',4,'3+',1,'E','Close Action, Scald-1, Volley-2')], launch:[L('Torpedo',2,'torpedo')], special:'Shield-4+' },
  'Thorium':                { role:'Super Battleship',   pts:305, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Obliterator Cannon','F',4,'3+',2,'C','Bloom-2, Critical-1, Focused'),W('Electrosurge Projectors','B',3,'4+',1,'E','Status, Volley-2'),W('Harpoon Deluge','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Shield-4+' },
  // ── Dreadnoughts ─────────────────────────────────────────────────────────
  'Plutonium':              { role:'Dreadnought',        pts:435, tonnage:'C', groupSize:1, thrust:8,  scan:14, sig:12, hull:22, es:'4+', ks:'3+', bs:'5+', weapons:[W('Distortion Cannons','F',6,'3+',1,'E','Critical-2, Penetrator'),W('Twin Particle Lance Turret','F/S',2,'3+',2,'C','Critical-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Harpoon Deluge','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Dropships',4,'gate_dropship')], special:'Mothership, Shield-3+' },
  'Uranium':                { role:'Dreadnought',        pts:410, tonnage:'C', groupSize:1, thrust:8,  scan:14, sig:12, hull:22, es:'4+', ks:'3+', bs:'5+', weapons:[W('Pulse Ioniser Battery','F',12,'*',1,'E','Burnthrough-2, Calibre-M/H/C, Close Action, Mauler'),W('Microwave Array Turret','F/S',5,'3+',1,'C','—'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Harpoon Deluge','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Dropships',4,'gate_dropship')], special:'Mothership, Shield-3+' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Twins of Aaru':      { role:'Famous Admiral (Cruiser)',    pts:245, tonnage:'M', groupSize:2, thrust:10, scan:12, sig:6,  hull:9,  es:'5+', ks:'4+', bs:'—', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1')], special:'Shield-4+, Twins, Famous Admiral Lv2' },
  'Seth':               { role:'Famous Admiral (Battlecruiser)', pts:195, tonnage:'H', groupSize:1, thrust:10, scan:12, sig:6,  hull:13, es:'5+', ks:'4+', bs:'6+', weapons:[W('Ion Aura','F/S/R',6,'3+',1,'E','Close Action, Scald-1'),W('Ion Storm','F/S/R',6,'4+',1,'E','Bombardment, Scald-1'),W('Gravity Coil Pair','FN',3,'2+',1,'E','Impel-2')], special:'Shield-4+, Vanguard-6", Gravitational Draw, Famous Admiral Lv2', vanguard:6 },
  'Mergen the Learned': { role:'Famous Admiral (Battleship)',    pts:295, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:8,  hull:18, es:'4+', ks:'3+', bs:'5+', weapons:[W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Particle Lance Triad','FN',3,'3+',2,'C','Critical-1')], launch:[L('Dropships',1,'gate_dropship')], special:'Mothership, Shield-4+, True Disintegration, Famous Admiral Lv3' },
  'Quetzalcoatl':       { role:'Famous Admiral (Dreadnought)',   pts:495, tonnage:'C', groupSize:1, thrust:8,  scan:14, sig:12, hull:22, es:'4+', ks:'3+', bs:'5+', weapons:[W('Pulse Ioniser Battery','F',12,'*',1,'E','Burnthrough-2, Calibre-M/H/C, Close Action, Mauler'),W('Microwave Array Turret','F/S',5,'3+',1,'C','—'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Disintegrator Battery','F/S',5,'3+',1,'E','Reave-1, Volley-2'),W('Harpoon Deluge','F/S/R',8,'4+',1,'K','Close Action')], launch:[L('Dropships',4,'gate_dropship')], special:'Mothership, Shield-3+, Radiation Aura, Famous Admiral Lv4' },
};

// ── RESISTANCE ────────────────────────────────────────────────────────────────

const RESISTANCE = {
  // ── Light (L tonnage) ─────────────────────────────────────────────────────
  'Munifex':        { role:'Corvette',              pts:19,  tonnage:'L', groupSize:2, thrust:12, scan:4,  sig:2,  hull:2,  es:'5+', ks:'6+', bs:'—',  weapons:[W('NCA-1 Missiles','F/S/R',4,'3+',1,'K','Air to Air, Close Action')], special:'Descent' },
  'Seneca':         { role:'Detonator',             pts:40,  tonnage:'L', groupSize:1, thrust:12, scan:4,  sig:2,  hull:2,  es:'4+', ks:'6+', bs:'—',  weapons:[], launch:[L('Fire Ships',2,'fire_ship')], special:'Descent, Explosive' },
  'Strike Carrier': { role:'Strike Carrier',        pts:35,  tonnage:'L', groupSize:1, thrust:11, scan:4,  sig:2,  hull:4,  es:'5+', ks:'5+', bs:'—',  weapons:[], launch:[L('Dropships',1,'dropship')], special:'Descent' },
  'Frigate':        { role:'Frigate',               pts:22,  tonnage:'L', groupSize:2, thrust:11, scan:4,  sig:2,  hull:4,  es:'5+', ks:'5+', bs:'—',  weapons:[], special:'Hardpoints (1 Frigate System)' },
  'Heavy Frigate':  { role:'Heavy Frigate',         pts:32,  tonnage:'L', groupSize:2, thrust:9,  scan:4,  sig:2,  hull:5,  es:'4+', ks:'5+', bs:'—',  weapons:[], special:'Reinforced Armour, Hardpoints (2 Frigate Systems)' },
  'Newton':         { role:'Kill-Sat',              pts:46,  tonnage:'L', groupSize:1, thrust:4,  scan:8,  sig:4,  hull:4,  es:'4+', ks:'6+', bs:'—',  weapons:[W('XN-40 Godray (Anti-Ship)','F',1,'3+',3,'C','Alt-1, Calibre-H/C'),W('XN-40 Godray (Bombardment)','F',1,'4+',3,'E','Alt-1, Bombardment, Penetrator')], special:'Monitor, Vanguard-4"' },
  'Galileo':        { role:'Orbital Telescope',     pts:55,  tonnage:'L', groupSize:1, thrust:4,  scan:12, sig:4,  hull:4,  es:'4+', ks:'6+', bs:'—',  weapons:[], special:'Detector, Monitor, Rare, Space Telescope' },
  'Sagitarii':      { role:'Cutter',                pts:30,  tonnage:'L', groupSize:1, thrust:16, scan:4,  sig:4,  hull:5,  es:'4+', ks:'6+', bs:'—',  weapons:[W('N-12 Artillery Cannon','F',4,'4+',1,'K','Fusillade-2')], special:'Vectored' },
  'Baleares':       { role:'Pocket Carrier',        pts:55,  tonnage:'L', groupSize:1, thrust:16, scan:4,  sig:4,  hull:5,  es:'4+', ks:'5+', bs:'—',  weapons:[], launch:[L('Fighters',2,'fighter'),L('Bombers',1,'bomber')], special:'Vectored' },
  'Armstrong':      { role:'Destroyer',             pts:65,  tonnage:'L', groupSize:1, thrust:9,  scan:6,  sig:4,  hull:6,  es:'4+', ks:'4+', bs:'6+', weapons:[W('HF-8 Clearance Laser (Focused)','F',4,'*',2,'E','Alt-1, Burnthrough-1, Calibre-L/M, Mauler'),W('HF-8 Clearance Laser (Wide)','F',6,'3+',0,'E','Alt-1, Anti Wing')], special:'Rare, Debris Clearance' },
  'Aldrin':         { role:'Colony Ship',           pts:75,  tonnage:'L', groupSize:1, thrust:9,  scan:6,  sig:4,  hull:6,  es:'4+', ks:'6+', bs:'6+', weapons:[], launch:[L('Bulk Landers',4,'bulk_lander')], special:'Descent' },
  'Collins':        { role:'Support Carrier',       pts:56,  tonnage:'L', groupSize:1, thrust:9,  scan:6,  sig:4,  hull:6,  es:'4+', ks:'5+', bs:'6+', weapons:[], launch:[L('Fighters & Bombers',1,'fighter_bomber')], special:'Rapid Drop, Wing Support' },
  'Guy Fawkes':     { role:'Fire Ship',             pts:85,  tonnage:'L', groupSize:1, thrust:9,  scan:6,  sig:4,  hull:6,  es:'2+', ks:'2+', bs:'6+', weapons:[W('Explosive Detonation','F/S/R',8,'3+',1,'C','Critical-1')], special:'Hero, Unique, Skeleton Crew, Explosive Detonation, Set Timers And Run' },
  // ── Medium Cruisers (modular hardpoints) ──────────────────────────────────
  'Light Cruiser':  { role:'Light Cruiser',         pts:45,  tonnage:'M', groupSize:2, thrust:9,  scan:4,  sig:4,  hull:9,  es:'5+', ks:'5+', bs:'—',  weapons:[], special:'Hardpoints (3 Cruiser Systems)' },
  'Cruiser':        { role:'Cruiser',               pts:60,  tonnage:'M', groupSize:1, thrust:7,  scan:4,  sig:6,  hull:11, es:'4+', ks:'5+', bs:'6+', weapons:[], special:'Hardpoints (4 Cruiser Systems)' },
  'Heavy Cruiser':  { role:'Heavy Cruiser',         pts:75,  tonnage:'M', groupSize:1, thrust:5,  scan:6,  sig:6,  hull:13, es:'4+', ks:'5+', bs:'6+', weapons:[], special:'Hardpoints (5 Cruiser Systems)' },
  'Centurion':      { role:'Grand Cruiser',         pts:125, tonnage:'M', groupSize:1, thrust:5,  scan:6,  sig:6,  hull:14, es:'3+', ks:'5+', bs:'5+', weapons:[W('9K Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('N-31 Hybrid Gun Battery','B',8,'4+',1,'K','Volley-2')], special:'Remnant' },
  'Gladiator':      { role:'Grand Cruiser',         pts:148, tonnage:'M', groupSize:1, thrust:5,  scan:6,  sig:6,  hull:14, es:'3+', ks:'5+', bs:'5+', weapons:[W('Heavy Vent Cannon Turret','F/S',2,'3+',2,'E','Fusillade-1, Overcharge, Reave-1'),W('Heavy Vent Cannons','F',4,'3+',2,'E','Fusillade-1, Reave-1')], special:'—' },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Senator':        { role:'Battlecruiser',         pts:145, tonnage:'H', groupSize:1, thrust:7,  scan:12, sig:6,  hull:15, es:'3+', ks:'4+', bs:'5+', weapons:[W('VX Bomb','F',3,'4+',2,'E','Bombardment, Limited-3'),W('NC-16 Missile Salvo','F/S/R',8,'3+',1,'K','Close Action')], special:'Vanguard-3", VX Bomb, Swacs' },
  'Triumvir':       { role:'Repair Cruiser',        pts:175, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'5+', weapons:[], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'Rare, Vanguard-3", Repair Bay, Box of Scraps' },
  'Phalanx':        { role:'Battlecruiser',         pts:165, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('N-31 Hybrid Gun Long Battery','B',9,'4+',1,'K','Fusillade-3, Volley-2')], special:'Vanguard-3"' },
  'Tribune':        { role:'Battlecruiser',         pts:210, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('N-11 Twin Artillery Cannon Turrets','F/S',6,'4+',1,'K','Fusillade-2, Low Power'),W('NC-16 Missile Bank','F/S/R',6,'3+',1,'K','Close Action, Volley-2')], launch:[L('Bulk Landers & Fire Ships',2,'bulk_lander'),L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-3"' },
  // ── Old Battleships ───────────────────────────────────────────────────────
  'Musashi':        { role:'Old Battleship',        pts:175, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:8,  hull:15, es:'3+', ks:'5+', bs:'5+', weapons:[W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2'),W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2'),W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2')], special:'—' },
  'Lexington':      { role:'Old Battleship',        pts:190, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:8,  hull:15, es:'3+', ks:'5+', bs:'5+', weapons:[W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action')], launch:[L('Fighters & Bombers',4,'fighter_bomber'),L('Torpedo',1,'torpedo')], special:'—' },
  'Iowa':           { role:'Old Battleship',        pts:175, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:8,  hull:15, es:'3+', ks:'5+', bs:'5+', weapons:[W('Heavy Vent Cannon Turrets','F/S',4,'3+',2,'E','Fusillade-1, Overcharge, Reave-1'),W('NC-16 Missile Battery','F/S/R',3,'3+',2,'K','Close Action')], special:'—' },
  'Vanguard':       { role:'Old Battleship',        pts:230, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:8,  hull:15, es:'3+', ks:'5+', bs:'5+', weapons:[W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Fusillade-1, Overcharge, Reave-1, Volley-2'),W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Fusillade-1, Overcharge, Reave-1, Volley-2'),W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action')], special:'—' },
  // ── Grand Battleships ─────────────────────────────────────────────────────
  'Nelson':         { role:'Grand Battleship',      pts:255, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('N-12 Artillery Cannon Battery','B',5,'4+',1,'K','Low Power, Volley-2'),W('N-12 Artillery Cannon Battery','B',5,'4+',1,'K','Low Power, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'—' },
  'Yi Sun-sin':     { role:'Grand Battleship',      pts:340, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Overcharge, Fusillade-2, Reave-1, Volley-2'),W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Overcharge, Fusillade-2, Reave-1, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'—' },
  'Barbarossa':     { role:'Grand Battleship',      pts:240, tonnage:'H', groupSize:1, thrust:5,  scan:10, sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('Heavy Vent Cannons','F',4,'3+',2,'E','Fusillade-1, Overcharge, Reave-1'),W('NC-16 Missile Battery','F/S/R',6,'3+',2,'K','Close Action, Volley-2'),W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2'),W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2')], special:'Detector, Scanning Systems' },
  'Farragut':       { role:'Grand Battleship',      pts:215, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('NC-16 Missile Battery Turret Quad','F/S/R',6,'3+',2,'K','Close Action, Volley-2'),W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2'),W('N-12 Artillery Cannon Half Battery','B',5,'4+',1,'K','Low Power, Volley-2')], launch:[L('Torpedo',3,'torpedo')], special:'—' },
  'Drake':          { role:'Grand Battleship',      pts:245, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('Spinal Mass Annihilator','FN',2,'2+',3,'C','Bloom-1, Crippling, Critical-2, Focused, High Power'),W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action'),W('Heavy Vent Cannon Turret','F/S',2,'3+',2,'E','Fusillade-1, Overcharge, Reave-1'),W('Heavy Vent Cannon Turret','F/S',2,'3+',2,'E','Fusillade-1, Overcharge, Reave-1')], special:'Spinal Mass Annihilator' },
  'Nimitz':         { role:'Grand Battleship',      pts:305, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('Spinal Vent Lance','FN',3,'3+',4,'E','Bloom-2, Overcharge, Reave-1'),W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action'),W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action')], launch:[L('Fighters & Bombers',4,'fighter_bomber')], special:'—' },
  'Yamamoto':       { role:'Grand Battleship',      pts:300, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('Spinal Vent Lance','FN',3,'3+',4,'E','Bloom-2, Overcharge, Reave-1'),W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('NC-16 Missile Battery Turret Pair','F/S/R',6,'3+',2,'K','Close Action')], launch:[L('Torpedo',2,'torpedo')], special:'—' },
  // ── Dreadnoughts (modular hardpoints) ────────────────────────────────────
  'Pathfinder':     { role:'Interstellar Raft',     pts:190, tonnage:'H', groupSize:1, thrust:5,  scan:8,  sig:8,  hull:18, es:'4+', ks:'4+', bs:'5+', weapons:[W('NC-16 Missiles','F/S/R',4,'3+',1,'K','Close Action')], special:'Hardpoints (4 Dreadnought Systems)' },
  'Explorer':       { role:'Interstellar Ark',      pts:210, tonnage:'C', groupSize:1, thrust:5,  scan:8,  sig:14, hull:22, es:'4+', ks:'4+', bs:'5+', weapons:[W('NC-16 Missiles','F/S/R',4,'3+',1,'K','Close Action')], special:'Command Ship-1, Hardpoints (6 Dreadnought Systems)' },
  'Coloniser':      { role:'Interstellar Dreadnought', pts:265, tonnage:'C', groupSize:1, thrust:5, scan:10, sig:16, hull:26, es:'4+', ks:'4+', bs:'5+', weapons:[W('NC-16 Missiles','F/S/R',4,'3+',1,'K','Close Action')], special:'Command Ship-2, Hardpoints (8 Dreadnought Systems)' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Typhoon Vasquez':    { role:'Famous Admiral (Heavy Cruiser)', pts:158, tonnage:'M', groupSize:1, thrust:5,  scan:10, sig:6,  hull:13, es:'3+', ks:'4+', bs:'6+', weapons:[W('N-11 Artillery Cannon Turret','F/S',3,'4+',1,'K','Fusillade-1, Low Power, Linked-1'),W('N-11 Artillery Cannon Turret','F/S',3,'4+',1,'K','Fusillade-1, Low Power, Linked-1'),W('N-8 Artillery Cannon Bank','B',6,'5+',1,'K','Fusillade-2, Low Power, Volley-2'),W('N-8 Artillery Cannon Bank','B',6,'5+',1,'K','Fusillade-2, Low Power, Volley-2')], special:'Reinforced Armour, Bullet Baron, Famous Admiral Lv2' },
  'Hagen':              { role:'Famous Admiral (Tribune)',       pts:255, tonnage:'H', groupSize:1, thrust:7,  scan:6,  sig:6,  hull:15, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turret','F/S',2,'2+',2,'K','Critical-1, Penetrator'),W('N-11 Twin Artillery Cannon Turrets','F/S',6,'4+',1,'K','Fusillade-2, Low Power'),W('NC-16 Missile Bank','F/S/R',6,'3+',1,'K','Close Action, Volley-2')], launch:[L('Torpedo',1,'torpedo'),L('Bulk Landers & Fire Ships',2,'bulk_lander'),L('Fighters & Bombers',2,'fighter_bomber')], special:'Vanguard-3", Famous Admiral Lv2' },
  'Nguen':              { role:'Famous Admiral (Grand Battleship)', pts:415, tonnage:'H', groupSize:1, thrust:5, scan:8, sig:8, hull:24, es:'3+', ks:'4+', bs:'5+', weapons:[W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('9K Mass Driver Turrets','F/S',2,'2+',2,'K','Critical-1, Penetrator, Volley-2'),W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Overcharge, Fusillade-2, Reave-1, Volley-2'),W('Mega Vent Cannon Half Battery','B',2,'3+',3,'E','Overcharge, Fusillade-2, Reave-1, Volley-2')], launch:[L('Torpedo',1,'torpedo')], special:'Extensive Reactor Modifications, Famous Admiral Lv4' },
  'Magellan':           { role:'Famous Admiral (Coloniser)',     pts:570, tonnage:'C', groupSize:1, thrust:8,  scan:10, sig:16, hull:26, es:'4+', ks:'4+', bs:'4+', weapons:[W('10K Mass Driver Turret','F/S',2,'3+',2,'K','Calibre-H/C, Critical-2, Penetrator, Volley-2'),W('10K Mass Driver Turret','F/S',2,'3+',2,'K','Calibre-H/C, Critical-2, Penetrator, Volley-2'),W('Heavy Dual Vent Cannon Turret','F/S',4,'3+',2,'E','Fusillade-2, Overcharge, Reave-1'),W('Heavy Dual Vent Cannon Turret','F/S',4,'3+',2,'E','Fusillade-2, Overcharge, Reave-1'),W('NC-16 Missiles','F/S/R',4,'3+',1,'K','Close Action')], launch:[L('Fighters & Bombers',4,'fighter_bomber'),L('Bulk Landers & Fire Ships',4,'bulk_lander')], special:'Command Ship-2, Famous Admiral Lv3' },
};

// ── BIOFICER ──────────────────────────────────────────────────────────────────

const BIOFICER = {
  // ── Corvette / Lighter ────────────────────────────────────────────────────
  'Vertex':          { role:'Corvette',       pts:30,  tonnage:'L', groupSize:2, thrust:12, scan:8,  sig:2,  hull:4,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Decon Slayer','FN',3,'3+',1,'E','Air to Air')], special:'Descent' },
  'Logic':           { role:'Lighter',        pts:20,  tonnage:'L', groupSize:3, thrust:16, scan:8,  sig:1,  hull:2,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Light Bombardment','F/S/R',3,'5+',1,'E','Alt-1, Bombardment')], launch:[L('Drop Pods',1,'drop_pod')], special:'Rare' },
  // ── Frigates ──────────────────────────────────────────────────────────────
  'Fugue':           { role:'Frigate',        pts:35,  tonnage:'L', groupSize:4, thrust:14, scan:8,  sig:1,  hull:3,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Lightvice','F/S',4,'2+',1,'K','Close Action, Focused')], special:'—' },
  'Forestall':       { role:'Frigate',        pts:38,  tonnage:'L', groupSize:4, thrust:14, scan:8,  sig:1,  hull:3,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Scythe Nodule','F',4,'4+',1,'E','Anti Wing, Fusillade-2, Reave-1')], special:'—' },
  'Foray':           { role:'Frigate',        pts:25,  tonnage:'L', groupSize:1, thrust:14, scan:8,  sig:1,  hull:3,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Decon Burst','F/S/R',1,'4+',1,'E','—')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Fulcrum':         { role:'Frigate',        pts:37,  tonnage:'L', groupSize:4, thrust:14, scan:10, sig:1,  hull:3,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Barb Spiker','FN',1,'2+',2,'K','Reave-2')], special:'—' },
  'Fresco':          { role:'Frigate',        pts:36,  tonnage:'L', groupSize:4, thrust:14, scan:8,  sig:1,  hull:3,  es:'5+', ks:'5+', bs:'—',  weapons:[W('Winnower','F/S',5,'4+',1,'E','Calibre-L, Close Action')], special:'—' },
  // ── Monitors ──────────────────────────────────────────────────────────────
  'Mantle':          { role:'Monitor',        pts:65,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:3,  hull:4,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Gravitic Pulveriser (Anti-Ship)','F',6,'3+',1,'C','Alt-1, Arrest-2, Close Action'),W('Gravitic Pulveriser (Bombardment)','F',6,'4+',1,'C','Alt-1, Bombardment')], special:'Monitor, Rare' },
  'Monarch':         { role:'Monitor',        pts:85,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:3,  hull:4,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Blast','F/S/R',4,'4+',1,'E','—')], launch:[L('Fighters & Bombers',3,'fighter_bomber')], special:'Monitor' },
  'Matrix':          { role:'Monitor',        pts:65,  tonnage:'L', groupSize:1, thrust:6,  scan:12, sig:3,  hull:4,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Blast','F/S/R',4,'4+',1,'E','—')], launch:[L('Boarding Pods',2,'boarding_pod')], special:'Monitor' },
  // ── Cutters ───────────────────────────────────────────────────────────────
  'Torrent':         { role:'Cutter',         pts:60,  tonnage:'L', groupSize:2, thrust:14, scan:8,  sig:3,  hull:5,  es:'5+', ks:'5+', bs:'6+', weapons:[W('Scythe Cluster','F',7,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1')], special:'—' },
  'Tine':            { role:'Cutter',         pts:52,  tonnage:'L', groupSize:2, thrust:14, scan:8,  sig:3,  hull:5,  es:'5+', ks:'5+', bs:'6+', weapons:[W('Gravitic Stave','FN',3,'4+',1,'C','Arrest-2')], special:'—' },
  'Tally':           { role:'Cutter',         pts:85,  tonnage:'L', groupSize:1, thrust:14, scan:8,  sig:3,  hull:5,  es:'5+', ks:'5+', bs:'6+', weapons:[W('Graviton Lens','F/S',4,'3+',1,'C','Close Action')], special:'Rare' },
  // ── Destroyers ────────────────────────────────────────────────────────────
  'Domain':          { role:'Destroyer',      pts:65,  tonnage:'L', groupSize:2, thrust:8,  scan:8,  sig:2,  hull:5,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Cannon','FN',7,'3+',1,'E','—')], special:'—' },
  'Diode':           { role:'Destroyer',      pts:75,  tonnage:'L', groupSize:2, thrust:8,  scan:8,  sig:2,  hull:5,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Bisector','FN',2,'3+',3,'E','Bloom-1, Calibre-H/C, Focused, Penetrator')], special:'—' },
  'Disciple':        { role:'Destroyer',      pts:55,  tonnage:'L', groupSize:2, thrust:8,  scan:8,  sig:2,  hull:5,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Blast','F/S/R',4,'4+',1,'E','—')], special:'Porter L-1' },
  'Anode':           { role:'Heavy Destroyer',pts:93,  tonnage:'L', groupSize:1, thrust:8,  scan:8,  sig:2,  hull:7,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Thermator Cage (Long Range)','FN',4,'4+',2,'E','Alt-1, Overcharge, Scald-2'),W('Thermator Cage (Short Range)','FN',4,'3+',2,'E','Alt-1, Close Action, Overcharge, Scald-3')], special:'Hero, Unique' },
  // ── Cells (Payload) ───────────────────────────────────────────────────────
  'Invasion Cell':   { role:'Cell',           pts:15,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:1,  hull:2,  es:'4+', ks:'4+', bs:'6+', weapons:[W('Bombardment','F/S/R',3,'5+',2,'E','Alt-1, Bombardment')], launch:[L('Drop Pods',1,'drop_pod')], vectored:true, special:'Payload S-1, Vectored', payload:{size:'S'} },
  'Lander Cell':     { role:'Cell',           pts:15,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:1,  hull:2,  es:'4+', ks:'4+', bs:'6+', weapons:[], launch:[L('Bulk Landers',2,'bulk_lander')], vectored:true, special:'Payload S-1, Vectored', payload:{size:'S'} },
  'Torpedo Cell':    { role:'Cell',           pts:20,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:1,  hull:2,  es:'4+', ks:'4+', bs:'6+', weapons:[], launch:[L('Torpedo',1,'torpedo')], special:'Payload S-1', payload:{size:'S'} },
  'Prism Cell':      { role:'Cell',           pts:10,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:1,  hull:2,  es:'4+', ks:'4+', bs:'6+', weapons:[W('Prism','F/S/R',4,'3+',1,'E','—')], vectored:true, special:'Aegis-1, Payload S-1, Vectored', payload:{size:'S'} },
  'Supercell':       { role:'Cell',           pts:55,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:3,  hull:3,  es:'3+', ks:'3+', bs:'4+', weapons:[W('Concussion Prism','F/S/R',6,'3+',1,'E','—')], vectored:true, special:'Aegis-3, Payload L-1, Vectored', payload:{size:'L'} },
  'Summoner Cell':   { role:'Cell',           pts:70,  tonnage:'L', groupSize:1, thrust:2,  scan:8,  sig:3,  hull:3,  es:'3+', ks:'3+', bs:'4+', weapons:[], launch:[L('Fighters & Bombers',3,'fighter_bomber')], vectored:true, special:'Payload L-1, Vectored', payload:{size:'L'} },
  // ── Light Cruisers ────────────────────────────────────────────────────────
  'Cache':           { role:'Light Cruiser',  pts:65,  tonnage:'M', groupSize:2, thrust:10, scan:8,  sig:2,  hull:5,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Heavy Lightvice','F',5,'2+',2,'K','Close Action, Focused')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Cipher':          { role:'Light Cruiser',  pts:70,  tonnage:'M', groupSize:2, thrust:10, scan:8,  sig:2,  hull:5,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Charger':         { role:'Light Cruiser',  pts:75,  tonnage:'M', groupSize:2, thrust:10, scan:11, sig:2,  hull:5,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Barb Launcher','FN',1,'2+',4,'K','Reave-2')], special:'Porter S-1', porter:{size:'S',cap:1} },
  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Callous':         { role:'Cruiser',        pts:80,  tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Ghost Orb','F/S',2,'3+',2,'E','Close Action, Status'),W('Decon Blaster','FN',3,'3+',1,'E','—')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Construct':       { role:'Cruiser',        pts:96,  tonnage:'M', groupSize:1, thrust:8,  scan:10, sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Barb Stinger','FN',1,'2+',2,'K','Reave-1')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Conqueror':       { role:'Cruiser',        pts:75,  tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Heavy Lightvice','F',5,'2+',2,'K','Close Action, Focused')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Choral':          { role:'Cruiser',        pts:80,  tonnage:'M', groupSize:1, thrust:8,  scan:11, sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Barb Launcher','FN',1,'2+',4,'K','Reave-2')], special:'Detector, Porter S-1', porter:{size:'S',cap:1} },
  'Comet':           { role:'Cruiser',        pts:82,  tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1'),W('Decon Blaster','FN',3,'3+',1,'E','—')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Cosmic':          { role:'Cruiser',        pts:88,  tonnage:'M', groupSize:1, thrust:8,  scan:11, sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Barb Launcher','FN',1,'2+',4,'K','Reave-2'),W('Barb Stinger','FN',1,'2+',2,'K','Reave-2')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Combine':         { role:'Cruiser',        pts:75,  tonnage:'M', groupSize:1, thrust:8,  scan:11, sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Barb Launcher','FN',1,'2+',4,'K','Reave-2')], special:'Porter S-2', porter:{size:'S',cap:2} },
  'Cavern':          { role:'Fleet Carrier',  pts:125, tonnage:'M', groupSize:1, thrust:8,  scan:8,  sig:3,  hull:7,  es:'4+', ks:'4+', bs:'—',  weapons:[W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1')], launch:[L('Fighters & Bombers',2,'fighter_bomber')], special:'Porter S-1, Minelayer', porter:{size:'S',cap:1} },
  // ── Heavy Cruisers ────────────────────────────────────────────────────────
  'Cataphract':      { role:'Heavy Cruiser',  pts:108, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:4,  hull:9,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Ghost Orb','F/S',2,'3+',2,'E','Close Action, Status'),W('Heavy Lightvice','F',5,'2+',2,'K','Close Action, Focused')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Cacophony':       { role:'Heavy Cruiser',  pts:132, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:4,  hull:9,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Catastrophe':     { role:'Heavy Cruiser',  pts:110, tonnage:'M', groupSize:1, thrust:7,  scan:8,  sig:4,  hull:9,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Heavy Lightvice','F',5,'2+',2,'K','Close Action, Focused'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], special:'Porter S-1', porter:{size:'S',cap:1} },
  'Carronade':       { role:'Heavy Cruiser',  pts:120, tonnage:'M', groupSize:1, thrust:7,  scan:11, sig:4,  hull:9,  es:'4+', ks:'4+', bs:'5+', weapons:[W('Barb Launcher','FN',1,'2+',4,'K','Reave-2'),W('Barb Launcher','FN',1,'2+',4,'K','Reave-2')], special:'Porter S-1', porter:{size:'S',cap:1} },
  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Scion':           { role:'Battlecruiser',  pts:150, tonnage:'H', groupSize:1, thrust:8,  scan:10, sig:4,  hull:12, es:'4+', ks:'4+', bs:'5+', weapons:[W('Hyper Lightvice','F',5,'2+',3,'K','Bloom-1, Close Action, Focused, Scald-1')], special:'Vanguard-6"' },
  'Sanctum':         { role:'Battlecruiser',  pts:185, tonnage:'H', groupSize:1, thrust:8,  scan:10, sig:4,  hull:12, es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Blast','F/S/R',4,'4+',1,'E','—')], launch:[L('Fighters & Bombers',5,'fighter_bomber')], special:'Vanguard-6"' },
  'Stature':         { role:'Battlecruiser',  pts:140, tonnage:'H', groupSize:1, thrust:8,  scan:10, sig:4,  hull:12, es:'4+', ks:'4+', bs:'5+', weapons:[W('Decon Annihilator','FN',12,'3+',1,'E','Reave-1')], special:'Vanguard-6"' },
  // ── Battleships ───────────────────────────────────────────────────────────
  'Binary':          { role:'Battleship',     pts:225, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:6,  hull:17, es:'3+', ks:'3+', bs:'5+', weapons:[W('Grand Bisector','FN',5,'3+',3,'E','Bloom-2, Calibre-H/C, Crippling, Focused, Penetrator'),W('Scythe Nodule','F',4,'4+',1,'E','Anti Wing, Fusillade-1, Reave-1'),W('Scythe Nodule','F',4,'4+',1,'E','Anti Wing, Fusillade-1, Reave-1')], special:'Porter L-1' },
  'Brutal':          { role:'Battleship',     pts:215, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:6,  hull:17, es:'3+', ks:'3+', bs:'5+', weapons:[W('Giga Winnower','F/S',15,'3+',1,'E','Calibre-L, Close Action, Fusillade-5'),W('Scythe Nodule','F',4,'4+',1,'E','Anti Wing, Fusillade-1, Reave-1'),W('Scythe Nodule','F',4,'4+',1,'E','Anti Wing, Fusillade-1, Reave-1')], special:'Porter L-1' },
  'Bastion':         { role:'Battleship',     pts:225, tonnage:'H', groupSize:1, thrust:8,  scan:12, sig:6,  hull:17, es:'3+', ks:'3+', bs:'5+', weapons:[W('Gravitic Hyperlance','FN',6,'3+',2,'C','Arrest-2, Bloom-2'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], special:'Porter L-1' },
  // ── Super Battleships ─────────────────────────────────────────────────────
  'Blackbird':       { role:'Super Battleship',pts:265,tonnage:'H', groupSize:1, thrust:6,  scan:12, sig:6,  hull:19, es:'3+', ks:'3+', bs:'5+', weapons:[W('Grand Bisector','FN',5,'3+',3,'E','Bloom-2, Calibre-H/C, Crippling, Focused, Penetrator'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], launch:[L('Boarding Pods',1,'boarding_pod')], special:'Marines-1, Porter L-1' },
  'Bishop':          { role:'Super Battleship',pts:265,tonnage:'H', groupSize:1, thrust:6,  scan:12, sig:6,  hull:19, es:'3+', ks:'3+', bs:'5+', weapons:[W('Giga Winnower','F/S',15,'3+',1,'E','Calibre-L, Close Action, Fusillade-5'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], launch:[L('Boarding Pods',1,'boarding_pod')], special:'Marines-1, Porter L-1' },
  'Binder':          { role:'Super Battleship',pts:270,tonnage:'H', groupSize:1, thrust:6,  scan:12, sig:6,  hull:19, es:'3+', ks:'3+', bs:'5+', weapons:[W('Gravitic Hyperlance','FN',6,'3+',2,'C','Arrest-2, Bloom-2'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], launch:[L('Boarding Pods',1,'boarding_pod')], special:'Marines-1, Porter L-1' },
  // ── Dreadnoughts ─────────────────────────────────────────────────────────
  'Zodiac':          { role:'Dreadnought',    pts:435, tonnage:'C', groupSize:1, thrust:6,  scan:14, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Decon Devastator Pair','FN',9,'3+',1,'E','Reave-2, Volley-2')], launch:[L('Fighters & Bombers',5,'fighter_bomber'),L('Boarding Pods',1,'boarding_pod')], special:'Marines-1, Reinforced Armour' },
  'Zenith':          { role:'Dreadnought',    pts:445, tonnage:'C', groupSize:1, thrust:6,  scan:14, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Giga Lightvice','F',8,'2+',3,'K','Bloom-1, Close Action, Focused, Scald-2')], launch:[L('Fighters & Bombers',5,'fighter_bomber'),L('Boarding Pods',1,'boarding_pod')], special:'Marines-1, Reinforced Armour' },
  // ── Famous Admirals ───────────────────────────────────────────────────────
  'Atlas':           { role:'Famous Admiral (Heavy Cruiser)', pts:155, tonnage:'M', groupSize:1, thrust:7, scan:8, sig:4, hull:9, es:'4+', ks:'4+', bs:'5+', weapons:[W('Heavy Lightvice','F',5,'2+',2,'K','Close Action, Focused'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], special:'Porter S-1, Famous Admiral Lv2', porter:{size:'S',cap:1} },
  'Atom':            { role:'Famous Admiral (Battlecruiser)', pts:195, tonnage:'H', groupSize:1, thrust:8, scan:10, sig:4, hull:12, es:'4+', ks:'4+', bs:'5+', weapons:[W('Godray Lightvice (Anti-Ship)','F',5,'2+',3,'K','Alt-1, Bloom-1, Close Action, Focused, Scald-1'),W('Godray Lightvice (Bombardment)','F',5,'4+',3,'K','Alt-1, Bloom-1, Bombardment, Close Action, Focused, Scald-1')], special:'Vanguard-6", Famous Admiral Lv2' },
  'Agency':          { role:'Famous Admiral (Battleship)',    pts:310, tonnage:'H', groupSize:1, thrust:8, scan:12, sig:6, hull:17, es:'3+', ks:'3+', bs:'4+', weapons:[W('Gravitic Hyperspear','FN',6,'3+',2,'C','Arrest-4, Bloom-2'),W('Thermator','F',3,'4+',2,'E','Overcharge, Scald-1')], launch:[L('Torpedo',2,'torpedo')], special:'Porter L-1, Famous Admiral Lv3' },
  'Ascendant':       { role:'Famous Admiral (Dreadnought)',   pts:605, tonnage:'C', groupSize:1, thrust:6, scan:14, sig:10, hull:22, es:'3+', ks:'3+', bs:'5+', weapons:[W('Giga Lightvice','F',8,'2+',3,'K','Bloom-1, Close Action, Focused, Scald-2'),W('Grand Bisector','FN',5,'3+',3,'E','Bloom-2, Calibre-H/C, Crippling, Focused, Penetrator'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1'),W('Scythes','FN',8,'4+',1,'E','Anti Wing, Fusillade-3, Reave-1')], launch:[L('Fighters & Bombers',5,'fighter_bomber'),L('Boarding Pods',3,'boarding_pod')], special:'Marines-3, Reinforced Armour, Famous Admiral Lv4' },
};

// ── Hardpoint option application ─────────────────────────────────────────────
// Maps lower-cased option names to their effect on a ship clone.

function _improveBy1(save) {
  const n = parseInt(save); return isNaN(n) ? save : (n - 1) + '+';
}
function _addSpecial(sp, rule) {
  if (!sp || sp === '—') return rule;
  return sp.includes(rule) ? sp : sp + ', ' + rule;
}

const _OPTION_WEAPONS = {
  'xn-31 mass driver turret':        () => W('XN-31 Mass Driver Turret','F/S',2,'2+',1,'K','Critical-1'),
  'n-11 artillery cannon turret':    () => W('N-11 Artillery Cannon Turret','F/S',3,'4+',1,'K','Fusillade-1, Low Power'),
  'n-109 bombardment mortar turret': () => W('N-109 Bombardment Mortar Turret','F/S/R',3,'4+',1,'K','Bombardment, Scald-1'),
  'vent cannon turret':              () => W('Vent Cannon Turret','F/S',3,'3+',1,'E','Overcharge, Reave-1'),
  'n-31 hybrid gun bank':            () => W('N-31 Hybrid Gun Bank','B',3,'4+',1,'K','Volley-2'),
  'n-8 artillery cannon bank':       () => W('N-8 Artillery Cannon Bank','B',6,'5+',1,'K','Fusillade-2, Low Power, Volley-2'),
  'nc-16 missile bank':              () => W('NC-16 Missile Bank','B',6,'3+',1,'K','Close Action, Volley-2'),
  'n-31 hybrid gun turret':          () => W('N-31 Hybrid Gun Turret','F/S',2,'3+',1,'K','Fusillade-1'),
  'nc-16 missile turret':            () => W('NC-16 Missile Turret','F/S/R',6,'3+',1,'K','Close Action'),
  'light vent cannon turret':        () => W('Light Vent Cannon Turret','F/S',2,'4+',1,'E','Overcharge, Reave-1'),
  '10k mass driver turret':          () => W('10K Mass Driver Turret','F/S',2,'3+',2,'K','Calibre-H/C, Critical-2, Penetrator, Volley-2'),
  'heavy dual vent cannon turret':   () => W('Heavy Dual Vent Cannon Turret','F/S',4,'3+',2,'E','Fusillade-2, Overcharge, Reave-1'),
  'n-31 hybrid gun battery':         () => W('N-31 Hybrid Gun Battery','B',8,'4+',1,'K','Volley-2'),
  'nc-16 missile battery':           () => W('NC-16 Missile Battery','B',6,'3+',2,'K','Close Action, Volley-2'),
};
const _OPTION_LAUNCHES = {
  'fighters & bombers':        () => L('Fighters & Bombers',2,'fighter_bomber'),
  'mines':                     () => L('Mines',2,'mine'),
  'bulk landers & fire ships': () => L('Bulk Landers & Fire Ships',2,'bulk_lander'),
  'torpedo':                   () => L('Torpedo',1,'torpedo'),
};

export function applyHardpointOptions(clone, options) {
  if (!options || !options.length) return;
  if (!clone.weapons) clone.weapons = [];
  if (!clone.launch)  clone.launch  = [];
  for (const opt of options) {
    const key = opt.toLowerCase().replace(/\s+/g,' ').trim();
    if (key === 'scanner array')    { clone.scan   = (clone.scan   || 0) + 4; continue; }
    if (key === 'drive refit')      { clone.thrust  = (clone.thrust || 0) + 3; continue; }
    if (key === 'laser refit')      {
      // Remove all UF-4200 Mass Driver Turret entries and add a Cobra Heavy Laser Pair.
      clone.weapons = (clone.weapons || []).filter(w => !/UF-4200 Mass Driver Turret/i.test(w.name));
      clone.weapons.push(W('Cobra Heavy Laser Pair','FN',6,'3+',1,'E','Burnthrough-2, Flash-2, Focused'));
      continue;
    }
    if (key === 'ablative armour')  {
      clone.es = _improveBy1(clone.es || '5+');
      clone.ks = _improveBy1(clone.ks || '5+');
      clone.special = _addSpecial(clone.special, 'Reinforced Armour');
      continue;
    }
    if (key === 'sensor dome') { clone.special = _addSpecial(clone.special, 'Detector'); continue; }
    if (_OPTION_WEAPONS[key])  { clone.weapons = [...clone.weapons, _OPTION_WEAPONS[key]()]; continue; }
    if (_OPTION_LAUNCHES[key]) { clone.launch  = [...clone.launch,  _OPTION_LAUNCHES[key]()]; continue; }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const FLEET_DB = { ucm: UCM, scourge: SCOURGE, phr: PHR, shaltari: SHALTARI, resistance: RESISTANCE, bioficer: BIOFICER };

// Case-insensitive name lookup with fuzzy prefix matching.
// Also strips parenthetical content so "Cruiser (Vent/Hybrid)" → "Cruiser" (Resistance modular ships).
export function findShipDef(factionKey, name) {
  const db = FLEET_DB[factionKey];
  if (!db) return null;
  const norm = s => s.toLowerCase().replace(/\s+/g,' ').trim();
  const target = norm(name);
  // Exact match first
  if (db[name]) return db[name];
  // Case-insensitive exact
  for (const k of Object.keys(db)) { if (norm(k) === target) return db[k]; }
  // Prefix match (e.g. "Rio" → "Rio Cruiser")
  for (const k of Object.keys(db)) { if (norm(k).startsWith(target) || target.startsWith(norm(k))) return db[k]; }
  // Strip parenthetical content and retry (e.g. "Cruiser (Vent/Hybrid)" → "Cruiser")
  const stripped = norm(name.replace(/\s*\([^)]*\)/g, ''));
  if (stripped !== target) {
    for (const k of Object.keys(db)) { if (norm(k) === stripped) return db[k]; }
    for (const k of Object.keys(db)) { if (norm(k).startsWith(stripped) || stripped.startsWith(norm(k))) return db[k]; }
  }
  return null;
}

// ── Faction admiral titles ────────────────────────────────────────────────────
// The exact title substrings that identify a named faction admiral (vs generic).
// Used to determine whether to show the faction ability picker in the fleet view.
// Keys are lower-case and matched case-insensitively against the parsed title.
export const FACTION_ADMIRAL_TITLES = {
  ucm:        ['captain', 'rear admiral'],
  scourge:    ['fleet thrall', 'fleet champion'],
  phr:        ['vizier', 'vice director'],
  shaltari:   ['skychief', 'starchief'],
  resistance: ['engineer', 'artificer'],
  bioficer:   ['ardent', 'accumulator'],
};

// ── Faction admiral personal abilities ───────────────────────────────────────
// Abilities that faction admirals (not famous) always have — separate from pool picks.
// Keyed by faction, then by lower-cased title keyword.
export const FACTION_ADMIRAL_PERSONAL = {
  ucm: {
    'captain':      [{ cost: 2, name: 'Dedicated Survey Teams',  desc: 'When you activate a Group of a single Ship, that Ship may Survey a Dropsite and also attack with a single weapon this round.' }],
    'rear admiral': [{ cost: 2, name: 'Overcharge Lasers',       desc: 'Pick one Laser weapon in an attacking Group. That weapon gains Fusillade-2 for that attack.' },
                     { cost: 2, name: 'Push Engines to Max',     desc: 'At start of a friendly Group\'s activation, each Ship in it suffers 1 damage and improves Thrust by 2" until end of activation.' }],
  },
  scourge: {
    'fleet thrall':   [{ cost: 1, name: 'Dissipate Energy', desc: 'At end of any Group\'s activation, target a friendly Group and remove 1 Spike.' },
                       { cost: 2, name: 'Silent Launch',    desc: 'When a friendly Group takes Silent Running, it may also launch Assets this round (Signature still 0").' }],
    'fleet champion': [{ cost: 1, name: 'Reaving Gaze', desc: 'Pick an Oculus weapon in an attacking Group. Replace its Scald-X with Reave-X (same value) for that attack. Costs 2AP if the Group has 2+ Ships.' }],
  },
  phr: {
    'vizier':        [{ cost: 1, name: 'Re-route Systems', desc: 'At start of a friendly Group\'s activation, remove one Crippling Effect token (of any type) from that Group.' },
                      { cost: 3, name: 'Ranked Fire',      desc: 'Pick a Broadside Volley-X weapon when assigning targets. That weapon does not need to alternate arcs for its Volley attacks — it may target the same arc with each Volley.' }],
    'vice director': [{ cost: 1, name: 'Akira Manoeuvre',  desc: 'When you activate a single-Ship Group, that Ship may make a Vectored move in addition to its normal movement.' }],
  },
  shaltari: {
    'skychief':  [{ cost: 2, name: 'Cunning Positioning', desc: 'When you move a Group of M Tonnage, that Group gains Vectored for that movement.' }],
    'starchief': [
      { cost: 2, name: 'Overclock Gates',  desc: 'At the start of the Activation Phase, pick a friendly Ship with the Gateship-X rule. That Ship doubles its X value until the end of the round. A Ship can only be affected by this Ability once each round.' },
      { cost: 3, name: 'Espionage',        desc: 'When an opponent declares the use of an Ability, negate that use of that Ability (AP is still spent as usual and subsequent uses are unaffected).' },
    ],
  },
  resistance: {
    'engineer':  [{ cost: 2, name: 'Artillery Strike',      desc: 'When assigning targets for an Artillery weapon, its damage type becomes Core for those attacks. Costs 3AP if the ship is H or C tonnage.' }],
    'artificer': [{ cost: 1, name: 'Manic Repairs',          desc: 'When you activate a Group, all Ships in it gain Regenerate-2 until end of round.' },
                  { cost: 2, name: 'Resistance Elite Force', desc: 'At end of the round, remove 2D3 enemy Battalions from a friendly Ship.' }],
  },
  bioficer: {
    'accumulator': [{ cost: 2, name: 'Backpedal', desc: 'At start of a friendly Group\'s activation, you may move each Ship in that Group up to 3" directly backwards.' }],
    'ardent':      [{ cost: 2, name: 'Gravitic Manoeuvring',   desc: 'When a friendly Group is given Max Thrust, it may turn as if on General Quarters.' },
                    { cost: 1, name: 'Kinetic Deconstruction', desc: 'When a friendly Group attacks with any Decon weapon, those weapons change their damage type to Kinetic for that activation.' }],
  },
};

// ── Faction ability pool ──────────────────────────────────────────────────────
// Abilities that famous and faction admirals may pick from when building lists.
// Each entry: { key, name, cost (AP), desc }
export const ADMIRAL_FACTION_ABILITIES = {
  ucm: [
    { key: 'colonial_legions',    cost: 2, name: 'Colonial Legions',           desc: 'After Battalion Combat, target a Dropsite/Feature. If any enemy Battalions removed friendly Battalions from it, place 1 friendly Battalion there.' },
    { key: 'intensify_pd',        cost: 1, name: 'Intensify Point-Defence',    desc: 'At end of Planning Phase, pick a friendly Group. All Ships in it improve Aegis-X by 2, or gain Aegis-1 if they don\'t have it.' },
    { key: 'infiltrate_sabotage', cost: 2, name: 'Infiltrate and Sabotage',    desc: 'At end of Planning Phase, pick a Dropsite within 6" of a friendly Group. It takes D3+1 Core hits.' },
    { key: 'mass_driver_volley',  cost: 2, name: 'Mass Driver Volley',         desc: 'When assigning weapons to a target, all attacking Mass Driver weapons improve their Lock by 1 for that attack.' },
    { key: 'atmospheric_bombing', cost: 1, name: 'Atmospheric Bombing Run',    desc: 'At start of Asset Phase, target a friendly Bomber Wing. That Wing gains Bombardment until end of round.' },
    { key: 'next_gen_armour',     cost: 2, name: 'Next-Gen Armour Plating',    desc: 'At end of Planning Phase, target a friendly Group. That Group may re-roll failed Energy Saves until end of round.' },
  ],
  scourge: [
    { key: 'for_the_species',       cost: 1, name: 'For the Species',        desc: 'At end of a friendly Group\'s activation, pick a Crippled ship in it. Roll 1 die per remaining Hull; a ship within 3" takes 1 damage per 3+. That Crippled ship is then destroyed (no explosion).' },
    { key: 'augmentations',         cost: 3, name: 'Augmentations',          desc: 'At start of a friendly Carrier\'s activation, if it has 2+ Bulk Landers, replace all with a single Orbital Defence Gun Feature until end of round. Once per round.' },
    { key: 'abandon_all_hope',      cost: 2, name: 'Abandon all Hope',       desc: 'At end of Planning Phase, target an opponent. That opponent discards D3 Ability Points.' },
    { key: 'assimilated_bioforms',  cost: 1, name: 'Assimilated Bioforms',   desc: 'At start of Battalion Combat, pick a City with friendly Battalions. Deploy D3 Assimilated Battalions there; remove any remaining at end of Battalion Combat.' },
    { key: 'high_speed_launch',     cost: 2, name: 'High Speed Launch',      desc: 'At end of Planning Phase, pick a friendly Group. It gains Rapid Drop and may launch Assets at end of activation while on Max Thrust until end of round.' },
    { key: 'expert_defence_crews',  cost: 1, name: 'Expert Defence Crews',   desc: 'At start of Asset Phase, pick a friendly Group. It gains Marines-2D3 until end of round.' },
  ],
  phr: [
    { key: 'countermeasures_hack', cost: 1, name: 'Countermeasures Hack',   desc: 'At start of a friendly Group\'s activation, target an enemy Group in LOS of a friendly Admiral. Until end of that activation it cannot use Backup Save, Aegis, or fighter Close Protection. Costs 2AP if targeting H or C tonnage.' },
    { key: 'weapons_hack',         cost: 2, name: 'Weapons Hack',           desc: 'Once per round, at start of an enemy Group\'s activation, choose one of its weapons. Until end of its activation, each attack die result of 1 causes the attacking Ship to lose Hull equal to that weapon\'s unmodified Damage.' },
    { key: 'ship_of_the_line',     cost: 1, name: 'Ship of the Line',       desc: 'When assigning targets, Broadside Fusillade weapons may always apply their Fusillade bonus regardless of the Group\'s order. On Weapons Free, double the Fusillade value instead.' },
    { key: 'drive_hack',           cost: 2, name: 'Drive Hack',             desc: 'Once per round, at end of Planning Phase, target an enemy Group in LOS. At start of its activation that Group rolls a Backup save; if it fails (or has none), it cannot use Course Change or Max Thrust this round.' },
    { key: 'repair_drones',        cost: 1, name: 'Repair Drone Squadron',  desc: 'At end of Repair step of End Phase, target a friendly Ship. It recovers D3 lost Hull Points.' },
    { key: 'elite_ground_forces',  cost: 2, name: 'Elite Ground Forces',    desc: 'At start of Battalion Combat, choose a Feature with friendly Battalions. Until end of that step, those Battalions remove 2 enemy Battalions instead of 1 and may target anywhere on the Dropsite in the 3rd step.' },
  ],
  shaltari: [
    { key: 'impel_mines',          cost: 1, name: 'Impel Mines',            desc: 'When a friendly H/C Carrier launches assets, it may also launch a single Impel Mine.' },
    { key: 'advanced_picket',      cost: 1, name: 'Advanced Picket Ships',  desc: 'When a Group uses its Shield-X special rule, roll a die. On a 4+, do not gain a Spike from that use.' },
    { key: 'misdirection',         cost: 1, name: 'Misdirection',           desc: 'At start of Asset Phase, pick a Dropsite. Redistribute all friendly Assets at that Dropsite and its Features.' },
    { key: 'nav_mastery',          cost: 1, name: 'Navigational Mastery',   desc: 'At start of a friendly Group\'s activation, that Group increases its Thrust by D3" until end of activation.' },
    { key: 'power_to_weapons',     cost: 2, name: 'Power to the Weapons',   desc: 'At start of a friendly Group\'s activation, it may fire any weapons on General Quarters but may not use Shield Saves until end of round.' },
    { key: 'lives_of_experience',  cost: -1, name: 'Lives of Experience',   desc: 'At start of each round, pick one Ability from any other Admiral on the table. This Ability becomes a copy of that Ability until end of round. Costs the same AP as the copied Ability.' },
  ],
  resistance: [
    { key: 'expert_repair_crews',  cost: 2, name: 'Expert Repair Crews',    desc: 'At start of Repair step of End Phase, remove all Crippling effects from a friendly Group.' },
    { key: 'duct_tape',            cost: 2, name: 'Duct Tape and Bubblegum', desc: 'When a friendly M/H/C Ship is destroyed by an opponent\'s attack, it remains in play until start of End Phase, then rolls for explosion and is removed. It counts as destroyed.' },
    { key: 'redundant_systems',    cost: 1, name: 'Redundant Ship Systems', desc: 'When rolling for Crippling Effects on a friendly Ship, roll 1D6 instead of 2D6. Count a result of 1 as 2.' },
    { key: 'final_mission',        cost: 1, name: 'Final Mission',          desc: 'When attacking with Fire Ships, one attacking Wing gains Corruptor-2 for that attack.' },
    { key: 'never_tell_odds',      cost: 1, name: 'Never Tell Me the Odds', desc: 'When a friendly Group or Wing moves through Scenery, ignore that Scenery piece\'s effects on movement.' },
    { key: 'sabotage',             cost: 2, name: 'Sabotage',               desc: 'At end of Activation Phase, before activating Dropsites, pick an enemy-controlled Dropsite within 6" of a friendly Group. It takes D3+1 Core Hits. Spend 1 extra AP to re-roll the D3.' },
  ],
  bioficer: [
    { key: 'good_fight',           cost: 1, name: 'Good Fight, We Should Do It More Often', desc: 'If a friendly Group\'s attack would completely remove an enemy Group, that friendly Group may immediately turn up to 45 degrees.' },
    { key: 'maddening_communique', cost: 3, name: 'Maddening Communiqué',   desc: 'At start of Activation Phase, pick an opponent. That opponent\'s Abilities cost 1 additional AP until end of round.' },
    { key: 'forcing_unfair_fight', cost: 2, name: 'Forcing an Unfair Fight', desc: 'At start of Activation Phase, pick a contested Dropsite. Add a friendly Battalion to each Feature on it. At start of End Phase Cleanup, remove a friendly Battalion from each Feature there.' },
    { key: 'precision_strike',     cost: 2, name: 'Precision Strike',       desc: 'When assigning a Group\'s weapons to targets, pick one weapon. Improve its Lock by 1 for that attack.' },
    { key: 'prismatic_surprise',   cost: 1, name: 'Prismatic Surprise',     desc: 'At end of Planning Phase, swap the attached Payloads of two Porter Ships with the same Porter value.' },
    { key: 'unsportsmanlike',      cost: 3, name: 'Unsportsmanlike Behaviour', desc: 'During this round\'s End Phase Cleanup, all players retain any unspent AP into the next round. Next round, only players who used this Ability can generate AP from Admirals.' },
  ],
};

// Famous admiral abilities — keyed by admiral name exactly as in FLEET_DB.
// Each entry: { key, name, cost (AP), desc }
export const FAMOUS_ADMIRAL_ABILITIES = {
  // UCM
  'Tayne':               [{ cost: 2, name: 'Close Quarter Battle',  desc: 'When a friendly Group moves, each Ship in it suffers 1 damage and gains Vectored until end of round.' }],
  'Weaver':              [{ cost: 2, name: 'Laser Bombardment',      desc: 'When assigning targets to an FN Laser weapon, that weapon gains Bombardment for that attack.' }],
  'Havelock':            [{ cost: 2, name: 'Ballistic Prediction',   desc: 'When assigning a Group\'s weapons to a target, pick one Mass Driver weapon. It improves its Lock by 1 for that attack.' }],
  '"Granite" Halsey':    [{ cost: 4, name: 'Master Tactician',       desc: 'At end of this Group\'s activation, discard a Pass Token and target another friendly L or M Group. If you do, that Group may turn up to 45°, move up to ¼ Thrust, and each Ship may attack with one weapon.' }],
  // Scourge
  'Overlord of Flies':   [{ cost: 2, name: 'Infernal Maw',           desc: 'After rolling to hit with a Furnace weapon, re-roll any of its attack dice (both hits and misses).' }],
  'Enslaver':            [{ cost: 2, name: 'Close in and Personal',   desc: 'When a friendly Group takes Max Thrust, each Ship in it may fire a single Close Action weapon during that activation.' }],
  'Flayer':              [{ cost: 1, name: 'Death Dispenser',         desc: 'When launching Dropships or Bulk Landers at a Dropsite, place an additional D3 Battalion tokens there.' }],
  'Baba Yaga':           [{ cost: 1, name: 'Limitless Pestilence',    desc: 'When a friendly Fighter or Bomber Wing is completely removed by an opponent\'s Fighters, immediately launch a single Fighter or Bomber from this Admiral\'s Ship.' }],
  // PHR
  'Javelin':             [{ cost: 2, name: 'Experimental Munitions',  desc: 'When assigning weapon targets, select one Calibre-X weapon. It gains the benefits of its Calibre-X rule regardless of target tonnage for that attack.' }],
  'Helena of Asgard':    [{ cost: 2, name: 'High-G Manoeuvre',        desc: 'When a friendly Group is given Max Thrust, it may turn as if on General Quarters.' }],
  'Claudia Rhee':        [{ cost: 2, name: 'Backup Systems Engaged',  desc: 'When a friendly Ship would roll for Crippling Damage, roll a die. On a 4+, that Ship does not roll on the Crippling table but is still Crippled.' }],
  'Gaius Chau':          [{ cost: 2, name: 'Backup Systems Engaged',  desc: 'When a friendly Ship would roll for Crippling Damage, roll a die. On a 4+, that Ship does not roll on the Crippling table but is still Crippled.' }],
  // Shaltari
  'Twins of Aaru':       [{ cost: 2, name: 'Cunning Positioning',     desc: 'When you move a Group of M Tonnage, that Group gains Vectored for that movement.' }],
  'Seth':                [{ cost: 2, name: 'Cunning Positioning',     desc: 'When you move a Group of M Tonnage, that Group gains Vectored for that movement.' }],
  'Mergen the Learned':  [{ cost: 1, name: 'Ancient Teleportation Node', desc: 'Once per round, at the end of the Planning Phase, target a Dropsite with friendly Battalions on it. That Dropsite gains the Gateship-1 special rule until the end of the round, treating the Dropsite as a Ship for this rule (any other rules are unaffected).' }],
  'Quetzalcoatl':        [{ cost: 2, name: 'Radioactivity',           desc: 'Before any player rolls for Explosion (friendly or enemy), make the final result of that roll a 5.' }],
  // Resistance
  'Typhoon Vasquez':     [{ cost: 2, name: 'Artillery Strike',        desc: 'When assigning targets for an Artillery weapon, its damage type becomes Core. Costs 3AP if the firing ship is H or C tonnage.' }],
  'Hagen':               [{ cost: 3, name: 'Reinforce Systems',       desc: 'When a friendly Ship of H or C tonnage would roll its Backup save due to an attack, improve its Backup save for that attack by 1.' }],
  'Nguen':               [{ cost: 2, name: 'Vent Cannon Mastery',     desc: 'When you Overcharge a Group\'s weapon with \'Vent\' in its name, each Ship in the firing Group may Overcharge a second weapon this activation.' }],
  'Magellan':            [{ cost: 2, name: 'Magellan Expedition',     desc: 'When you launch Bulk Landers from this Ship or a Ship within 6" of it, you may have that Ship launch an additional 2 or 4 Bulk Landers. Any Ship that does takes that much damage (causing Crippling Effects and Explosions where applicable).' }],
  // Bioficer
  'Atlas':               [{ cost: 1, name: 'One Upsmanship',          desc: 'If this Admiral is your highest-level Admiral, whenever your opponent uses an Ability, roll a die. On a 4+, gain 1AP.' }],
  'Atom':                [{ cost: 1, name: 'Vice Lightly',             desc: 'When you assign targets to a weapon with \'Lightvice\' in its name, that weapon ignores its Focused rule for that attack.' }],
  'Agency':              [{ cost: 2, name: 'Synthetic Grav Waves',    desc: 'When you inflict damage to an enemy Ship with a weapon with the Arrest-X special rule, each Ship in the damaged Group is affected by the Arrest rule and increases its X value by 2 for that attack.' }],
  'Ascendant':           [{ cost: 2, name: 'Overwatch',               desc: 'When you activate this Ship on General Quarters, you may choose to forgo attacking. If you do, this Ship goes on Overwatch until end of round or until it declares Overwatch. At the end of any enemy Group\'s activation, if that Group moved through this Ship\'s Front arc and was in weapons range, you may declare Overwatch: this Ship immediately attacks as if on General Quarters against that Group, even if it is out of arc and weapon range.' }],
};

// ── Ship special rule descriptions ───────────────────────────────────────────
// Only rules that need explanation — stat-tagged rules (Aegis-X, Vanguard-X, etc.)
// are self-evident and omitted. Keys match either the exact tag or its prefix
// (everything before the first "-"). Value: string or function(param) → string.
// Named ship/admiral unique rules are keyed by their exact rule name.
export const SHIP_SPECIAL_RULES = {
  // ── UCM — famous admiral ship rules ───────────────────────────────────────
  'Stressful Manoeuvre': () => 'When firing the Cobra Heavy Laser Pair, may suffer 1 damage to change its Arc to F for that attack.',
  'Jink':                () => 'At the start or end of this Flagship\'s movement, place it up to 2" sideways (along a line through both side arcs). On Max Thrust, place it up to 4" instead.',
  'Spearhead':           () => 'While within 12" of the opponent\'s deployment zone, may re-roll failed Backup saves.',
  'Fighter Command':     () => 'Fighters, Bombers & Heavy Bombers launched from this ship may be placed up to 8" away instead of 6".',

  // ── UCM — named ship rules ─────────────────────────────────────────────────
  'Stealth Drop':    () => '2 Dropships are needed to place 1 Battalion. If this Group contains a single ship, each Dropship only places a Battalion on a 4+.',
  'UCMF Battlenet':  () => 'An admiral on this ship gains two Command Abilities: Telemetry Link (2AP — an activated Orbit Group gains +4" movement this round) and Order to Fire (2AP — an activated Orbit Group either fires an extra weapon, or fires one weapon before moving).',
  'UCMA Battlenet':  () => 'An admiral on this ship gains two Command Abilities: Double Time Bulk Line (2AP — a friendly Group may launch Bulk Landers as if the target Dropsite has no enemy Battalions) and Feet First into Hell (2AP — a friendly Atmosphere Group may launch Dropships or Drop Pods at 6" range, Drop Pods ignore Alt-Launch).',

  // ── Scourge — famous admiral ship rules ───────────────────────────────────
  'Doomed':          () => 'Whenever you capture an enemy Ship or an enemy Ship is destroyed due to the Fire Crippling Effect, gain 2AP.',
  'Savagery':        () => 'When this Flagship becomes Crippled, it gains the Impetuous and Vectored special rules.',
  'Death Mistress':  () => 'Whenever an enemy Group is completely destroyed, roll a dice. On a 4+ gain 1AP.',
  'Winged Bulwark':  () => 'Friendly Wings that activate within 14" of this Flagship may not move further than 14" away from it. This Ship may launch Assets regardless of its order (retaining Signature 0" on Silent Running and the bonus turn on Course Change).',

  // ── Scourge — named ship rules ─────────────────────────────────────────────
  'Energy Siphon':   () => 'Before or after any activation step, pick a Group within 3" (without this rule): that Group loses all Spikes, this Group gains them. After siphoning 1+ Spikes: +1 Attack on Siphoned Oculus Rays (+2 if 3+ Spikes gained). On GQ or SR orders, this Group gains Regenerate-X equal to Spikes removed at activation start.',

  // ── PHR — famous admiral ship rules ───────────────────────────────────────
  'Self Repairing Armour Systems': () => 'This Flagship\'s Energy Save cannot be reduced below a 5+.',
  'Cull the Weak':   () => 'The Heavy Quad Battery (Flak) weapon may only target Ships of L Tonnage.',
  'Cutting Power':   () => 'If attacking with Energy Glaive Batteries without Overcharging, those batteries gain Reave-2 for those attacks.',

  // ── PHR — named ship rules ─────────────────────────────────────────────────
  'Advanced ECM Suite': () => 'When a friendly Group within 4" is attacked, after weapons are assigned, reduce the Lock of one attacking Ship\'s weapons by 1 for the rest of the round. Each ship with this rule may use it once per round.',
  'Targeting Link':     () => 'Friendly Ships within Scan range may use this ship as a spotter: measure weapon range from this ship\'s position using its Scan value. Attacks must still be in Arc and line of sight of the firing ship.',
  'Holo Interference Field': () => 'After activation, place a 4" diameter token within 3". While it persists, enemy ships ignore Spikes and Signature when attacking through it; enemy Fighters & Bombers that move into or are placed under it are removed on a 4+. Removed in End Phase cleanup.',

  // ── Shaltari — famous admiral ship rules ──────────────────────────────────
  'Twins':              () => 'This Admiral counts as being aboard both ships in the Group simultaneously. Only removed when the entire Group is destroyed.',
  'Gravitational Draw': () => 'Whenever this Flagship\'s Gravity Coils cause a ship to turn due to the Impel rule, gain 1AP.',
  'True Disintegration':() => 'When a hit from this Flagship\'s Disintegrator Battery destroys a Ship, skip the explosion roll — instead, all Ships in explosion range suffer 1 damage.',
  'Radiation Aura':     () => 'At the end of this Ship\'s activation, each enemy Group within 4" suffers D3 Core hits.',

  // ── Shaltari — named ship rules ────────────────────────────────────────────
  'Void Skip':      () => 'On General Quarters within 6" of a Gateship: instead of a normal move, place this Group within 6" of any Gateship in the chain (any facing, Orbit or Atmosphere). Gains a Spike.',
  'Shield Booster': () => 'While in coherency, when a friendly Group within 6" uses its Shield Save, improve that Shield-X by 1 (max 3+), but this Group gains a Spike. Only while this Group has fewer than 4 Spikes. Each Save can only be improved by this rule once.',

  // ── Resistance — famous admiral ship rules ────────────────────────────────
  'Bullet Baron':                   () => 'This ship must be configured with two N-8 Artillery Cannon Banks, two N-11 Artillery Cannon Turrets, Ablative Armour, and a Scanner Array.',
  'Extensive Reactor Modifications': () => 'If Vent Cannon Overcharge damage would destroy this Ship, roll 3D3 for its explosion and the explosion also affects Ships in other Orbital Layers.',

  // ── Resistance — named ship rules ──────────────────────────────────────────
  'Remnant':         () => 'May be taken in UCM or PHR fleets as well as Resistance fleets (gains the Rare special rule in those fleets).',
  'Explosive':       () => 'When destroyed, this ship explodes with a range of 3" and rolls 1D3 on the Explosion Effect table.',
  'Debris Clearance':() => 'Once per game: forgo all attacks this activation to replace a Debris Field within 6" with a Micrometeor Cloud, or remove a Micrometeor Cloud within 6".',
  'Space Telescope': () => 'When using the Detector rule, may also place a Telescope token on a Group. When weapons are later assigned to that Group, remove the token to lower the critical threshold of one weapon by 1 for that attack.',
  'Wing Support':    () => 'Friendly Fighters within 6" provide Close Protection against Kinetic weapons; each removes 2 Bombers instead of 1. Friendly Bombers within 6" use Saturation Fire at 5+ Bombers instead of 6+.',
  'Explosive Detonation': () => 'Skip weapon assignment — each 6 to hit generates an extra attack die; hits are spread equally to all Ships on the same layer within 6". After the attack, remove this ship from the game.',
  'Set Timers And Run':   () => 'After Explosive Detonation resolves, if a friendly Ship is within 8", place a Fawkes\' Crew Battalion on it. This ship only counts for Kill Points when that Battalion is removed.',
  'Skeleton Crew':        () => 'This Ship can only be given General Quarters orders.',
  'VX Bomb':         () => 'Gains Scald-2 when targeting Cities. If this weapon damages a Dropsite, all Battalions (friendly and enemy) on that Dropsite and its Features are removed.',
  'Swacs':           () => 'Enemy Ships within 12" of this ship may be targeted by friendly Close Action weapons using the firing ship\'s normal weapon range.',
  'Repair Bay':      () => 'Friendly Ships within 6" repair Crippling Effects on a 2+ during End Phase (instead of 4+). Ships that end activation within 6" on the same layer recover 2 Hull Points.',
  'Box of Scraps':   () => 'After activation, place a Box of Scraps token on a friendly ship within 6". The next time that ship would be destroyed, remove the token instead — it survives with D3 Hull remaining (then continue applying remaining damage).',
  'Scanning Systems':() => 'When using the Detector rule, also place two additional Spikes on a different enemy Group in line of sight.',
  'Spinal Mass Annihilator': () => 'If damage from this weapon (or a Crippling Effect it causes) would destroy a ship, remove it from the game without rolling for Explosion.',

  // ── Bioficer — named ship rules ────────────────────────────────────────────
  'One Upsmanship':        () => 'If this Admiral is your highest-level Admiral, whenever your opponent uses an Ability, roll a dice. On a 4+ gain 1AP.',
  'Godray Lightvice':      () => 'When targeting a Dropsite with a friendly Bioficer Deployable Feature, friendly Battalions on that Feature ignore Collateral Damage from this weapon.',
  'Giga Lightvice':        () => 'When determining targets, may use an unmodifiable Scan of 7" regardless of this ship\'s actual Scan value.',
  'High Velocity Boarding Pods': () => 'This Ship\'s Boarding Pods may be used against targets up to 6" away.',
  'Limited Aegis Bandwidth': () => 'Friendly Ships with this rule may combine their Aegis values as a single Group, but only those within 6" of the benefiting Group count. Ships with this rule cannot benefit from another ship with this rule.',
  'Summoning Cell':   () => 'When activating a Wing within 4", instead of normal movement remove them from the table and place them anywhere within 18" of this Ship (ignoring intervening scenery). May still form or divide wings as normal.',
  'Gravitational Lensing': () => 'Once per round, when a friendly ship within 8" determines targets, treat one of its weapons as having Arc F/S for that attack.',
  'Tractor Beamer':   () => 'After this Ship\'s activation, pick a friendly Ship with the Payload special rule within 6" and move it up to 4" in any direction.',
};
