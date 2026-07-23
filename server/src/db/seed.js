/**
 * ExamPro seed — reproduces the dashboard state from the design mock.
 * Time-anchored to "now" so there is always one live exam and recent history.
 * Run: npm run seed   (from exampro/ or exampro/server/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, q, nowIso } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { rng, shuffled, fmtPct } from '../lib/util.js';
import { config } from '../config.js';

const rand = rng(20260529);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

console.log('Seeding ExamPro…');

// ---- wipe ------------------------------------------------------------------
db.exec(`
  PRAGMA foreign_keys = OFF;
  DELETE FROM grading_overrides; DELETE FROM violations; DELETE FROM answers;
  DELETE FROM student_sessions; DELETE FROM attempts; DELETE FROM ai_generations;
  DELETE FROM notes; DELETE FROM questions; DELETE FROM exam_roster_overrides;
  DELETE FROM question_banks; DELETE FROM exams; DELETE FROM enrollments;
  DELETE FROM students; DELETE FROM course_teachers; DELETE FROM courses;
  DELETE FROM teacher_sessions; DELETE FROM teachers; DELETE FROM presence_samples;
  DELETE FROM audit_logs;
  DELETE FROM sqlite_sequence;
  PRAGMA foreign_keys = ON;
`);

// ---- teachers ---------------------------------------------------------------
const insTeacher = db.prepare(
  `INSERT INTO teachers (name, email, password_hash, role, created_at) VALUES (?,?,?,?,?)`
);
const john = Number(insTeacher.run('John Doe', 'john.doe@exampro.edu', hashPassword('demo1234'), 'teacher', iso(NOW - 90 * DAY)).lastInsertRowid);
const alice = Number(insTeacher.run('Alice Chen', 'alice.chen@exampro.edu', hashPassword('demo1234'), 'teacher', iso(NOW - 80 * DAY)).lastInsertRowid);
const mark = Number(insTeacher.run('Mark Rivera', 'mark.rivera@exampro.edu', hashPassword('demo1234'), 'teacher', iso(NOW - 80 * DAY)).lastInsertRowid);
const admin = Number(insTeacher.run('System Admin', 'admin@exampro.edu', hashPassword('admin1234'), 'admin', iso(NOW - 120 * DAY)).lastInsertRowid);

// ---- courses ----------------------------------------------------------------
const insCourse = db.prepare(
  `INSERT INTO courses (owner_id, code, title, term, term_end, color, created_at) VALUES (?,?,?,?,?,?,?)`
);
const courses = {};
function addCourse(key, code, title, term, color, endingDays = null, owner = john) {
  const id = Number(insCourse.run(owner, code, title, term, endingDays ? iso(NOW + endingDays * DAY) : null, color, iso(NOW - 60 * DAY)).lastInsertRowid);
  courses[key] = id; return id;
}
addCourse('bio201', 'BIO 201', 'Human Physiology', 'Fall 2026', '#16a34a', 12);
addCourse('bio103', 'BIO 103', 'Anatomy & Structure', 'Spring 2026', '#0ea5e9', 18);
addCourse('bio202', 'BIO 202', 'Microbiology', 'Fall 2026', '#8b5cf6');
addCourse('bio105', 'BIO 105', 'Biochemistry', 'Spring 2026', '#f59e0b');
addCourse('chem110', 'CHEM 110', 'General Chemistry', 'Fall 2026', '#ef4444');
addCourse('neur400', 'NEUR 400', 'Neuroscience', 'Fall 2026', '#06b6d4');
addCourse('bio301', 'BIO 301', 'Genetics', 'Spring 2026', '#ec4899');
addCourse('phys210', 'PHYS 210', 'Biophysics', 'Fall 2026', '#64748b');

// co-teachers / TAs
const insCT = db.prepare(`INSERT INTO course_teachers (course_id, teacher_id, role, created_at) VALUES (?,?,?,?)`);
insCT.run(courses.bio201, alice, 'ta', iso(NOW - 50 * DAY));
insCT.run(courses.bio103, mark, 'co-teacher', iso(NOW - 50 * DAY));

// ---- students (320) ----------------------------------------------------------
const FIRST = ['Amara', 'Jonas', 'Priya', 'Diego', 'Mei', 'Fatima', 'Kwame', 'Elena', 'Ravi', 'Sofia', 'Tunde', 'Ingrid', 'Omar', 'Grace', 'Yuki', 'Nadia', 'Samuel', 'Lucia', 'Peter', 'Aisha', 'Mateo', 'Hana', 'Victor', 'Zara', 'Felix', 'Leila', 'Daniel', 'Anya', 'Marcus', 'Chloe', 'Ibrahim', 'Nina', 'Oscar', 'Reema', 'Tom', 'Wanjiru', 'Alex', 'Bianca', 'Chen', 'Dara'];
const LAST = ['Okafor', 'Smith', 'Patel', 'Garcia', 'Wang', 'Hassan', 'Mensah', 'Petrova', 'Sharma', 'Rossi', 'Adeyemi', 'Larsen', 'Farouk', 'Kim', 'Tanaka', 'Aziz', 'Brown', 'Mendez', 'Novak', 'Ali', 'Silva', 'Kobayashi', 'Ivanov', 'Diallo', 'Weber', 'Osei', 'Nguyen', 'Kaur', 'Lopez', 'Dubois', 'Yilmaz', 'Moreau', 'Costa', 'Aliyu', 'Schmidt', 'Juma', 'Dube', 'Ferrero', 'Liu', 'Kane'];
const insStudent = db.prepare(`INSERT INTO students (roll_no, name, email, created_at) VALUES (?,?,?,?)`);
const studentIds = [];
for (let i = 0; i < 320; i++) {
  const roll = `STU-${1001 + i}`;
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`;
  const id = Number(insStudent.run(roll, name, `${roll.toLowerCase()}@student.edu`, iso(NOW - 45 * DAY)).lastInsertRowid);
  studentIds.push(id);
}

const insEnroll = db.prepare(`INSERT OR IGNORE INTO enrollments (course_id, student_id, added_via, created_at) VALUES (?,?,?,?)`);
function enroll(courseId, ids, via = 'csv') {
  for (const s of ids) insEnroll.run(courseId, s, via, iso(NOW - 40 * DAY));
}
const R = {}; // roster slices
R.bio201 = studentIds.slice(0, 120);
R.bio103 = studentIds.slice(120, 205);
R.bio202 = studentIds.slice(205, 265);
R.bio105 = studentIds.slice(265, 320);
R.chem110 = shuffled(studentIds, rand).slice(0, 70);
R.neur400 = shuffled(studentIds, rand).slice(0, 45);
R.bio301 = shuffled(studentIds, rand).slice(0, 60);
R.phys210 = shuffled(studentIds, rand).slice(0, 50);
for (const k of Object.keys(R)) enroll(courses[k], R[k]);

// ---- question helpers --------------------------------------------------------
const insQ = db.prepare(
  `INSERT INTO questions (exam_id, bank_id, type, text, options_json, correct_index, points, model_answer, source, flagged, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);
function mcq(examId, text, options, correct, points = 2, flagged = 0) {
  return Number(insQ.run(examId, null, 'mcq', text, JSON.stringify(options), correct, points, null, 'manual', flagged, iso(NOW - 20 * DAY)).lastInsertRowid);
}
function essay(examId, text, model, points = 10) {
  return Number(insQ.run(examId, null, 'essay', text, null, null, points, model, 'manual', 0, iso(NOW - 20 * DAY)).lastInsertRowid);
}
function bankMcq(bankId, text, options, correct, points = 2) {
  return Number(insQ.run(null, bankId, 'mcq', text, JSON.stringify(options), correct, points, null, 'manual', 0, iso(NOW - 20 * DAY)).lastInsertRowid);
}

// ---- exams -------------------------------------------------------------------
const insExam = db.prepare(
  `INSERT INTO exams (course_id, title, description, access_code, start_at, duration_min,
     shuffle_questions, shuffle_options, allow_backtracking, question_source, bank_id, question_count,
     severity_policy, ai_grading_enabled, use_roster_override, results_released, pass_pct, created_by, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
function addExam(c, title, code, startMs, durMin, opts = {}) {
  return Number(insExam.run(
    c, title, opts.desc || `${title} — proctored online exam`, code, iso(startMs), durMin,
    opts.shuffleQ === false ? 0 : 1, opts.shuffleO === false ? 0 : 1, opts.backtrack === false ? 0 : 1,
    opts.bankId ? 'bank' : 'custom', opts.bankId || null, opts.qCount || null,
    opts.policy || 'warn_limit', opts.aiGrading ? 1 : 0, opts.override ? 1 : 0,
    opts.released ? 1 : 0, opts.passPct || 50, john, iso(NOW - 10 * DAY)
  ).lastInsertRowid);
}

// LIVE: Cardiology Final (BIO 201) — started 25 min ago, 2 h total
const cardioLive = addExam(courses.bio201, 'Cardiology Final Exam', 'CARD-7291', NOW - 25 * MIN, 120, { aiGrading: true });
mcq(cardioLive, 'Which phase of the cardiac cycle immediately follows atrial systole?', ['Ventricular systole', 'Isovolumetric relaxation', 'Ventricular filling', 'Atrial diastole'], 0);
mcq(cardioLive, 'The SA node is primarily located in the…', ['Right atrial wall', 'Interventricular septum', 'Left ventricular apex', 'AV bundle'], 0);
mcq(cardioLive, 'Which ECG wave represents ventricular depolarization?', ['QRS complex', 'P wave', 'T wave', 'U wave'], 0);
mcq(cardioLive, 'Stroke volume is best defined as…', ['Blood ejected per beat', 'Blood pumped per minute', 'End-diastolic volume', 'Total peripheral resistance'], 0);
mcq(cardioLive, 'A beta-1 blocker primarily decreases…', ['Heart rate and contractility', 'Afterload only', 'Venous capacitance only', 'AV nodal conduction only'], 0);
mcq(cardioLive, 'The correct order of electrical conduction is…', ['SA → AV → Bundle of His → Purkinje', 'AV → SA → Purkinje → His', 'SA → Purkinje → AV → His', 'AV → His → SA → Purkinje'], 0);
mcq(cardioLive, 'Mean arterial pressure is approximately…', ['DBP + 1/3 pulse pressure', 'SBP + DBP ÷ 2', 'SBP − DBP', '2/3 SBP + 1/3 DBP'], 0);
mcq(cardioLive, 'Baroreceptors that regulate blood pressure are found in the…', ['Carotid sinus and aortic arch', 'Pulmonary veins', 'Coronary sinus', 'Vena cava only'], 0);
mcq(cardioLive, 'Which ion is chiefly responsible for the plateau phase of the cardiac action potential?', ['Calcium', 'Sodium', 'Potassium', 'Chloride'], 0);
mcq(cardioLive, 'Preload is most closely related to…', ['End-diastolic volume', 'Aortic pressure', 'Heart rate', 'Contractility'], 0);
mcq(cardioLive, 'An S3 heart sound is most associated with…', ['Ventricular volume overload', 'Aortic stenosis', 'Mitral prolapse', 'Pericardial friction'], 0);
mcq(cardioLive, 'The Frank–Starling mechanism states that increased ventricular filling…', ['Increases stroke volume', 'Decreases contractility', 'Blocks conduction', 'Lowers heart rate'], 0);
essay(cardioLive, 'Explain the cardiac cycle from atrial systole to ventricular filling, naming valve states and pressure relationships.', 'Model: Atrial systole tops up ventricular filling with AV valves open and semilunar valves closed. Ventricular systole begins: AV valves close (S1), isovolumetric contraction raises pressure until aortic/pulmonary valves open; ejection follows. Isovolumetric relaxation after semilunar closure (S2), then rapid filling when ventricular pressure falls below atrial pressure. Mention pressure gradients driving each transition.', 10);
essay(cardioLive, 'Describe the mechanism of action of ACE inhibitors and their effect on preload and afterload.', 'Model: ACE inhibitors block conversion of angiotensin I to II, reducing vasoconstriction (lower afterload) and aldosterone-mediated Na+/water retention (lower preload); also reduce bradykinin breakdown. Used in hypertension and heart failure.', 10);

// LIVE #2 (ending soon): Micro lab safety (BIO 202) — started 100 min ago, 112 min
const microLive = addExam(courses.bio202, 'Micro Lab Safety Check', 'MLAB-2210', NOW - 100 * MIN, 112, { override: true });
mcq(microLive, 'Biosafety cabinet class II protects…', ['Personnel, product and environment', 'Product only', 'Personnel only', 'None of these'], 0, 1);
mcq(microLive, 'Autoclaving standard is…', ['121°C, 15 psi, 15–20 min', '100°C, 5 min', '60°C, 1 hour', '160°C, 10 min'], 0, 1);
mcq(microLive, 'The first step after a culture spill is…', ['Alert others and cover with disinfectant-soaked towels', 'Wipe with dry tissue', 'Open all windows', 'Leave the room silently'], 0, 1);
mcq(microLive, 'BSC Class I offers protection for…', ['Personnel and environment only', 'Product only', 'All three', 'None'], 0, 1);
essay(microLive, 'List four rules of aseptic technique and why each matters.', 'Model: flame/sterilize loops between transfers; work near flame or in BSC to reduce contamination; minimize time vessels are open; disinfect bench before/after; never mouth-pipette. Each reduces contamination or exposure risk.', 5);

// SCHEDULED
const pharmMid = addExam(courses.bio201, 'Pharmacology Midterm', 'PHRM-4472', NOW + 45 * MIN, 90, { override: true, aiGrading: true });
mcq(pharmMid, 'Bioavailability of an oral drug is most affected by…', ['First-pass hepatic metabolism', 'Plasma pH only', 'Tablet color', 'Patient age alone'], 0);
mcq(pharmMid, 'A drug with a narrow therapeutic index requires…', ['Careful plasma monitoring', 'No monitoring', 'Double dosing', 'Topical use only'], 0);
mcq(pharmMid, 'The volume of distribution relates dose to…', ['Plasma concentration', 'Half-life', 'Clearance', 'Bioavailability'], 0);
mcq(pharmMid, 'Zero-order elimination means…', ['Constant amount cleared per time', 'Constant fraction cleared', 'No clearance', 'Instant clearance'], 0);
mcq(pharmMid, 'An agonist has…', ['Affinity and intrinsic efficacy', 'Affinity only', 'Efficacy only', 'Neither'], 0);
essay(pharmMid, 'Compare competitive and non-competitive antagonists with one clinical example each.', 'Model: Competitive — reversible binding at same site, surmountable (e.g., naloxone vs opioids). Non-competitive — allosteric/irreversible, insurmountable (e.g., phenoxybenzamine on alpha receptors).', 10);

const anatQuiz2 = addExam(courses.bio103, 'Anatomy Quiz 2', 'ANAT-2204', NOW + 26 * HOUR, 45, { override: true });
mcq(anatQuiz2, 'The brachial plexus originates from spinal roots…', ['C5–T1', 'C1–C4', 'T1–T5', 'L1–L4'], 0, 2);
mcq(anatQuiz2, 'The deltoid is innervated by the…', ['Axillary nerve', 'Radial nerve', 'Ulnar nerve', 'Median nerve'], 0, 2);
mcq(anatQuiz2, 'The cubital fossa borders include…', ['Brachioradialis laterally', 'Triceps medially', 'Deltoid superiorly', 'Pronator quadratus anteriorly'], 0, 2);
mcq(anatQuiz2, 'The scaphoid articulates with the…', ['Radius', 'Ulna', 'Humerus', 'Metacarpal 5'], 0, 2);
mcq(anatQuiz2, 'The ulnar nerve passes…', ['Posterior to the medial epicondyle', 'Through the carpal tunnel', 'Anterior to lateral epicondyle', 'Through the spiral groove'], 0, 2);

const biochemLab = addExam(courses.bio201, 'Biochemistry Lab Test', 'BCHM-8821', NOW + 2 * DAY + 2 * HOUR, 60, { override: true });
mcq(biochemLab, 'The Michaelis constant Km equals…', ['Substrate concentration at half Vmax', 'Maximum velocity', 'Enzyme concentration', 'Turnover number'], 0, 2);
mcq(biochemLab, 'A competitive inhibitor increases…', ['Apparent Km', 'Vmax', 'Enzyme synthesis', 'Km and Vmax'], 0, 2);
mcq(biochemLab, 'SDS-PAGE separates proteins primarily by…', ['Size', 'Charge', 'Hydrophobicity', 'Shape only'], 0, 2);
mcq(biochemLab, 'The Bradford assay detects…', ['Protein concentration', 'DNA purity', 'Lipid content', 'Glucose'], 0, 2);

// far-future scheduled exams to fill "24 upcoming exams"
const laterSpecs = [
  ['bio202', 'Virology Midterm', 'VIRO-3301', 8], ['bio202', 'Mycology Quiz', 'MYCO-3302', 15],
  ['bio105', 'Metabolism Final', 'METB-5101', 9], ['bio105', 'Protein Structure Quiz', 'PROT-5102', 20],
  ['bio103', 'Neuroanatomy Midterm', 'NEUA-1201', 10], ['bio103', 'Histology Practical', 'HIST-1202', 24],
  ['bio201', 'Respiratory Physiology Quiz', 'RESP-3201', 5], ['bio201', 'Endocrinology Midterm', 'ENDO-3202', 12],
  ['chem110', 'Thermodynamics Exam', 'THERM-101', 7], ['chem110', 'Kinetics Midterm', 'KIN-102', 18],
  ['neur400', 'Synaptic Transmission Exam', 'SYN-4001', 11], ['neur400', 'Neuropharmacology Final', 'NPH-4002', 27],
  ['bio301', 'Mendelian Genetics Quiz', 'MEND-3011', 6], ['bio301', 'Population Genetics Midterm', 'POPG-3012', 16],
  ['phys210', 'Biomechanics Exam', 'BMECH-2101', 13], ['phys210', 'Bioelectricity Final', 'BELEC-2102', 22],
  ['bio202', 'Immunology Basics Quiz', 'IMM-3303', 4], ['bio105', 'Lipid Metabolism Quiz', 'LIP-5103', 26],
];
for (const [k, title, code, days] of laterSpecs) {
  const ex = addExam(courses[k], title, code, NOW + days * DAY + 9 * HOUR, 60);
  mcq(ex, `${title}: sample stem 1`, ['Option A (correct)', 'Option B', 'Option C', 'Option D'], 0, 2);
  mcq(ex, `${title}: sample stem 2`, ['Option A (correct)', 'Option B', 'Option C', 'Option D'], 0, 2);
  essay(ex, `${title}: short-answer prompt`, 'Model answer for grading reference.', 6);
}

// Roster overrides (make-up / subset cohorts)
const insOverride = db.prepare(`INSERT OR IGNORE INTO exam_roster_overrides (exam_id, student_id, created_at) VALUES (?,?,?)`);
for (const s of R.bio201.slice(0, 90)) insOverride.run(pharmMid, s, iso(NOW - 5 * DAY));
for (const s of shuffled(R.bio103, rand).slice(0, 60)) insOverride.run(anatQuiz2, s, iso(NOW - 5 * DAY));
for (const s of R.bio201.slice(0, 45)) insOverride.run(biochemLab, s, iso(NOW - 5 * DAY));
for (const s of R.bio202.slice(0, 40)) insOverride.run(microLive, s, iso(NOW - 5 * DAY));

// COMPLETED exams (results released) — feed analytics, rollup, integrity
const renalQuiz = addExam(courses.bio201, 'Renal Physiology Quiz', 'RENL-2051', NOW - 4 * DAY - 3 * HOUR, 45, { released: true });
const renalQs = [
  mcq(renalQuiz, 'Filtration occurs primarily at the…', ['Glomerulus', 'Loop of Henle', 'Collecting duct', 'Distal tubule'], 0),
  mcq(renalQuiz, 'ADH acts mainly on the…', ['Collecting duct', 'PCT', 'Glomerulus', 'Loop thin limb'], 0),
  mcq(renalQuiz, 'Renin is released in response to…', ['Low renal perfusion pressure', 'High NaCl at macula densa', 'High blood volume', 'Hyperkalemia alone'], 0),
  mcq(renalQuiz, 'Normal GFR is about…', ['125 mL/min', '25 mL/min', '600 mL/min', '1 L/min'], 0),
  mcq(renalQuiz, 'Aldosterone increases reabsorption of…', ['Na+ in DCT/collecting duct', 'Glucose', 'Water only', 'K+'], 0),
  mcq(renalQuiz, 'The countercurrent multiplier is in the…', ['Loop of Henle', 'PCT', 'Glomerulus', 'Renal pelvis'], 0),
];

const anat1 = addExam(courses.bio103, 'Anatomy Quiz 1', 'ANAT-1103', NOW - 5 * DAY - 2 * HOUR, 40, { released: true });
const anat1Qs = [
  mcq(anat1, 'The femur articulates with the pelvis at the…', ['Acetabulum', 'Glenoid', 'Trochlea', 'Condyle'], 0, 2),
  mcq(anat1, 'The gastrocnemius inserts via the…', ['Calcaneal tendon', 'Patellar ligament', 'IT band', 'Plantar fascia'], 0, 2),
  mcq(anat1, 'The popliteal artery is a continuation of the…', ['Femoral artery', 'Iliac artery', 'Tibial artery', 'Peroneal artery'], 0, 2),
  mcq(anat1, 'Which muscle dorsiflexes the foot?', ['Tibialis anterior', 'Soleus', 'Peroneus longus', 'Flexor hallucis'], 0, 2),
];

const biomid = addExam(courses.bio105, 'Biochemistry Midterm', 'BMID-1150', NOW - 6 * DAY - 4 * HOUR, 75, { released: true });
const biomidQs = [
  mcq(biomid, 'Glycolysis occurs in the…', ['Cytosol', 'Mitochondrial matrix', 'Nucleus', 'ER'], 0),
  mcq(biomid, 'The Krebs cycle produces how many ATP directly per turn?', ['1 (GTP)', '10', '3', '32'], 0),
  mcq(biomid, 'Rate-limiting enzyme of glycolysis is…', ['PFK-1', 'Hexokinase', 'Pyruvate kinase', 'Aldolase'], 0),
  mcq(biomid, 'Oxidative phosphorylation occurs at…', ['Inner mitochondrial membrane', 'Outer membrane', 'Cytosol', 'Ribosome'], 0),
  mcq(biomid, 'An allosteric enzyme shows…', ['Sigmoidal kinetics', 'Linear kinetics', 'No regulation', 'Michaelis-Menten always'], 0),
];

const micro1 = addExam(courses.bio202, 'Micro Quiz 1', 'MICR-1180', NOW - 3 * DAY - 1 * HOUR, 30, { released: true });
const micro1Qs = [
  mcq(micro1, 'Gram-positive cell walls are rich in…', ['Peptidoglycan', 'LPS', 'Porins only', 'Chitin'], 0, 2),
  mcq(micro1, 'The Gram stain crystal violet is decolorized by…', ['Alcohol/acetone', 'Safranin', 'Iodine', 'Water'], 0, 2),
  mcq(micro1, 'Obligate anaerobes lack…', ['Catalase/SOD defenses', 'Ribosomes', 'DNA', 'Membranes'], 0, 2),
];

const physMid = addExam(courses.bio201, 'Physiology Midterm', 'PMID-2071', NOW - 25 * DAY, 90, { released: true });
for (let i = 0; i < 10; i++) mcq(physMid, `Midterm concept check ${i + 1}`, ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], 0);
const cellsQuiz = addExam(courses.bio201, 'Cells & Tissue Quiz', 'CELL-2010', NOW - 40 * DAY, 30, { released: true });
for (let i = 0; i < 6; i++) mcq(cellsQuiz, `Cell biology item ${i + 1}`, ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], 0, 2);
const chemQuiz = addExam(courses.chem110, 'Stoichiometry Quiz', 'STCH-101', NOW - 10 * DAY, 45, { released: true });
for (let i = 0; i < 8; i++) mcq(chemQuiz, `Stoichiometry item ${i + 1}`, ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], 0, 2);
const neurMid = addExam(courses.neur400, 'Neuro Midterm', 'NMD-4001', NOW - 45 * DAY, 90, { released: true });
for (let i = 0; i < 10; i++) mcq(neurMid, `Neuro item ${i + 1}`, ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], 0);

// UNRELEASED essay exam with pending AI grading (AI Essay Grading queue)
const enzymeEssay = addExam(courses.bio105, 'Enzyme Kinetics Essay Test', 'ENZY-1199', NOW - 1 * DAY - 2 * HOUR, 50, { aiGrading: true });
const enzQ1 = essay(enzymeEssay, 'Derive the meaning of Km and Vmax from the Michaelis–Menten equation and explain their physiological significance.', 'Model: Vmax is the maximal rate at enzyme saturation; Km is substrate concentration at half Vmax, reflecting apparent affinity. Low Km = high affinity. Vmax proportional to enzyme concentration. Physiological relevance: enzyme capacity vs substrate availability.', 10);
const enzQ2 = essay(enzymeEssay, 'Distinguish competitive, non-competitive and uncompetitive inhibition on Lineweaver–Burk plots.', 'Model: Competitive — same y-intercept (Vmax unchanged), increased slope (Km up). Non-competitive — lower y-intercept (Vmax down), Km unchanged. Uncompetitive — parallel lines (both down).', 10);
const enzQ3 = essay(enzymeEssay, 'Explain how allosteric regulation differs from covalent modification, with examples.', 'Model: Allostery — reversible non-covalent effector binding at a secondary site (e.g., ATCase). Covalent — enzyme-catalyzed modification like phosphorylation (e.g., glycogen phosphorylase).', 10);

// Question bank + bank-mode exam
const insBank = db.prepare(`INSERT INTO question_banks (course_id, name, created_at) VALUES (?,?,?)`);
const bankId = Number(insBank.run(courses.bio201, 'Physiology Master Bank', iso(NOW - 30 * DAY)).lastInsertRowid);
const BANK_ITEMS = [
  ['Which structure separates the thoracic and abdominal cavities?', ['Diaphragm', 'Pleura', 'Peritoneum', 'Mediastinum']],
  ['Resting membrane potential is closest to…', ['−70 mV', '0 mV', '+30 mV', '−110 mV']],
  ['Nernst potential depends on…', ['Ion concentration gradient', 'ATP level', 'Membrane thickness', 'Cell size']],
  ['Tidal volume in a healthy adult is about…', ['500 mL', '150 mL', '1200 mL', '3 L']],
  ['FEV1/FVC is reduced in…', ['Obstructive disease', 'Restrictive disease', 'Anemia', 'Fever']],
  ['Surfactant is produced by…', ['Type II pneumocytes', 'Type I pneumocytes', 'Macrophages', 'Goblet cells']],
  ['The pacemaker of gut smooth muscle is…', ['Interstitial cells of Cajal', 'Meissner plexus', 'Vagus nerve', 'Circular muscle']],
  ['Bile is stored in the…', ['Gallbladder', 'Liver', 'Pancreas', 'Duodenum']],
  ['Insulin is secreted by…', ['Beta cells', 'Alpha cells', 'Delta cells', 'Acinar cells']],
  ['Cortisol is produced in the…', ['Zona fasciculata', 'Zona glomerulosa', 'Medulla', 'Zona reticularis']],
];
for (const [t, o] of BANK_ITEMS) bankMcq(bankId, t, o, 0);
for (let i = BANK_ITEMS.length; i < 30; i++) {
  bankMcq(bankId, `Physiology bank item ${i + 1}`, ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], 0);
}
const popQuiz = addExam(courses.bio201, 'Cumulative Pop Quiz', 'POPQ-3100', NOW + 3 * DAY + 5 * HOUR, 20, { bankId, qCount: 10 });

// ---- notes (AI Studio source material) ---------------------------------------
function writeNote(courseId, filename, text) {
  const stored = path.join(config.uploadsDir, `seed-${filename}`);
  fs.writeFileSync(stored, text, 'utf8');
  fs.writeFileSync(stored + '.txt', text, 'utf8');
  return Number(q.run(
    `INSERT INTO notes (course_id, filename, stored_path, mime, chars, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)`,
    courseId, filename, stored, 'text/plain', text.length, john, iso(NOW - 2 * DAY)
  ).lastInsertRowid);
}
const cardioNotes = writeNote(courses.bio201, 'cardiology-notes.txt',
`CARDIOVASCULAR PHYSIOLOGY — LECTURE NOTES
Cardiac cycle: atrial systole tops up ventricular filling with AV valves open. Ventricular systole: AV valves close (S1), isovolumetric contraction, then semilunar valves open for ejection. S2 marks semilunar closure and isovolumetric relaxation.
Electrical conduction: SA node (right atrium) → AV node → Bundle of His → bundle branches → Purkinje fibers. ECG: P wave atrial depolarization, QRS ventricular depolarization, T wave ventricular repolarization.
Hemodynamics: Cardiac output = heart rate × stroke volume. MAP ≈ DBP + 1/3 pulse pressure. Baroreceptors in carotid sinus and aortic arch modulate sympathetic/parasympathetic tone.
Starling: increased end-diastolic volume increases stroke volume up to a limit. Preload relates to EDV; afterload to aortic pressure. S3 suggests volume overload.
Pharmacology: beta-1 blockers reduce heart rate and contractility. ACE inhibitors reduce angiotensin II: less vasoconstriction (afterload down) and less aldosterone-driven Na+/water retention (preload down).`);
writeNote(courses.bio201, 'pharmacology-notes.txt',
`PHARMACOKINETICS BASICS
Bioavailability: fraction of dose reaching systemic circulation; oral drugs undergo first-pass hepatic metabolism. Volume of distribution = dose / plasma concentration. Half-life depends on clearance and Vd.
First-order elimination: constant fraction per unit time. Zero-order: constant amount (e.g., ethanol).
Pharmacodynamics: agonist = affinity + efficacy; antagonist = affinity only. Competitive antagonists are surmountable (naloxone). Non-competitive are not (phenoxybenzamine). Narrow therapeutic index drugs need plasma monitoring (digoxin, lithium, phenytoin).`);

// ---- attempts ---------------------------------------------------------------
const insAttempt = db.prepare(
  `INSERT INTO attempts (exam_id, student_id, status, started_at, ends_at, submitted_at, order_json, answered_count, score, max_score, violations_count, last_seen)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
);
const insAnswer = db.prepare(
  `INSERT INTO answers (attempt_id, question_id, selected_index, essay_text, is_correct, points_awarded, ai_score, ai_rationale, final_score, grading_status, graded_by, graded_at, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);
const insViolation = db.prepare(
  `INSERT INTO violations (attempt_id, type, detail, strike, created_at) VALUES (?,?,?,?,?)`
);

function qsOf(examId) { return q.all(`SELECT * FROM questions WHERE exam_id = ? ORDER BY id`, examId); }
function orderFor(qRows, seedBase) {
  const rnd = rng(seedBase);
  return JSON.stringify(shuffled(qRows, rnd).map((qq) => ({
    question_id: qq.id,
    options: qq.type === 'mcq' ? shuffled((JSON.parse(qq.options_json).map((_, i) => i)), rnd) : null,
  })));
}

// Completed, graded attempts with per-question answers
function completedAttempts(examId, rosterSlice, opts = {}) {
  const {
    mean = 83, sd = 12, skipRate = 0.02, subs = null,
    startedAgo = 4 * DAY + 2 * HOUR, examDur = 40 * MIN,
    essayMode = 'graded', // 'graded' | 'ai_pending_mix'
    ts = NOW,
  } = opts;
  const qRows = subs || qsOf(examId);
  const exam = q.get(`SELECT * FROM exams WHERE id = ?`, examId);
  const end = Date.parse(exam.start_at) + exam.duration_min * MIN;
  // per-question difficulty: easier vs harder items
  const difficulty = qRows.map(() => Math.min(0.97, Math.max(0.35, mean / 100 + between(-0.25, 0.15))));
  rosterSlice.forEach((stId, idx) => {
    const seed = examId * 10007 + idx * 131;
    const rnd = rng(seed);
    const started = Date.parse(exam.start_at) + Math.floor(rnd() * 5 * MIN);
    const submitted = Math.min(end - 1, started + Math.floor(examDur * (0.7 + rnd() * 0.3)));
    const order = orderFor(qRows, seed);
    const attId = Number(insAttempt.run(
      examId, stId, 'submitted', iso(started), iso(end), iso(submitted), order,
      0, null, null, 0, iso(submitted)
    ).lastInsertRowid);
    let score = 0, max = 0, answered = 0;
    const orderArr = JSON.parse(order);
    qRows.forEach((qq, qi) => {
      max += qq.points;
      const o = orderArr.find((x) => x.question_id === qq.id);
      if (qq.type === 'mcq') {
        if (rnd() < skipRate) {
          insAnswer.run(attId, qq.id, null, null, 0, 0, null, null, 0, 'auto', null, iso(submitted), iso(started), iso(submitted));
          return;
        }
        const correct = rnd() < difficulty[qi];
        const origIdx = correct ? qq.correct_index : (qq.correct_index + 1 + Math.floor(rnd() * (JSON.parse(qq.options_json).length - 1))) % JSON.parse(qq.options_json).length;
        const pts = correct ? qq.points : 0;
        score += pts; answered++;
        insAnswer.run(attId, qq.id, origIdx, null, correct ? 1 : 0, pts, null, null, pts, 'auto', null, iso(submitted), iso(started), iso(submitted));
      } else {
        // essays
        const qLevel = Math.min(qq.points, Math.max(0, qq.points * (mean / 100) + between(-sd / 12, sd / 12)));
        const useAiPending = essayMode === 'ai_pending_mix' && idx % 4 === 0; // 25% pending AI review
        const finalScore = useAiPending ? null : Math.round(qLevel * 10) / 10;
        if (finalScore != null) score += finalScore;
        answered++;
        insAnswer.run(
          attId, qq.id, null, `Student response draft for: ${qq.text.slice(0, 60)}… (seed)`, null, 0,
          useAiPending ? Math.round(qLevel * 10) / 10 : null,
          useAiPending ? 'Suggested score based on coverage of model-answer key points and use of correct terminology.' : null,
          finalScore, useAiPending ? 'ai_pending' : 'confirmed',
          useAiPending ? null : john, useAiPending ? null : iso(submitted),
          iso(started), iso(submitted)
        );
      }
    });
    q.run(`UPDATE attempts SET answered_count = ?, score = ?, max_score = ? WHERE id = ?`, answered, Math.round(score * 10) / 10, max, attId);
    return attId;
  });
}

// Historical completed exams
completedAttempts(renalQuiz, R.bio201.slice(0, 118), { mean: 86, sd: 9 });
completedAttempts(anat1, R.bio103.slice(0, 83), { mean: 78, sd: 13 });
completedAttempts(biomid, R.bio105.slice(0, 54), { mean: 70, sd: 12 });
completedAttempts(micro1, R.bio202.slice(0, 58), { mean: 82, sd: 10 });
completedAttempts(physMid, R.bio201, { mean: 84, sd: 11 });
completedAttempts(cellsQuiz, R.bio201.slice(0, 110), { mean: 79, sd: 14 });
completedAttempts(chemQuiz, R.chem110.slice(0, 40), { mean: 81, sd: 12 });
completedAttempts(neurMid, R.neur400.slice(0, 38), { mean: 77, sd: 13 });
completedAttempts(enzymeEssay, R.bio105.slice(0, 30), { mean: 74, sd: 10, essayMode: 'ai_pending_mix' });

// ---- LIVE attempts now -------------------------------------------------------
function liveAttempts(examId, rosterIds, { cleanN, warnN, violN, startedMinSpread = 22 }) {
  const exam = q.get(`SELECT * FROM exams WHERE id = ?`, examId);
  const qRows = exam.question_source === 'bank' && exam.bank_id ? qsOfBankUsed(exam) : qsOf(examId);
  const end = Date.parse(exam.start_at) + exam.duration_min * MIN;
  let i = 0;
  const mk = (stId, violations) => {
    const seed = examId * 90001 + stId * 37;
    const rnd = rng(seed);
    const started = NOW - Math.floor(rnd() * startedMinSpread * MIN);
    const answeredCount = Math.max(1, Math.round(qRows.length * (0.3 + rnd() * 0.5)));
    const order = orderFor(qRows, seed);
    const attId = Number(insAttempt.run(
      examId, stId, 'in_progress', iso(started), iso(end), null, order,
      answeredCount, null, null, violations.length, iso(NOW - Math.floor(rnd() * 60e3))
    ).lastInsertRowid);
    // partial answers for realism
    const orderArr = JSON.parse(order).slice(0, answeredCount);
    for (const o of orderArr) {
      const qq = qRows.find((x) => x.id === o.question_id);
      if (qq?.type === 'mcq') {
        insAnswer.run(attId, qq.id, o.options[Math.floor(rnd() * o.options.length)], null, null, 0, null, null, null, 'none', null, null, iso(started), iso(NOW - Math.floor(rnd() * 300e3)));
      } else if (qq) {
        insAnswer.run(attId, qq.id, null, 'Draft answer in progress…', null, 0, null, null, null, 'none', null, null, iso(started), iso(NOW - 60000));
      }
    }
    violations.forEach((v, vi) => {
      insViolation.run(attId, v, '', vi + 1, iso(NOW - (violations.length - vi) * 5 * MIN));
    });
  };
  function qsOfBankUsed(exam) { return q.all(`SELECT * FROM questions WHERE bank_id = ? LIMIT ?`, exam.bank_id, exam.question_count || 10); }
  for (const stId of rosterIds.slice(0, cleanN)) mk(stId, []);
  for (const stId of rosterIds.slice(cleanN, cleanN + warnN)) mk(stId, ['tab_blur']);
  let v2 = 0;
  for (const stId of rosterIds.slice(cleanN + warnN, cleanN + warnN + violN)) {
    mk(stId, v2 % 2 === 0 ? ['tab_blur', 'right_click'] : ['tab_blur', 'devtools']);
    v2++;
  }
}
// Cardiology live: STU-1001..=idx0 and STU-1002 not started (leave first two out for demo login)
const cardioRosterLive = R.bio201.slice(2, 120);
liveAttempts(cardioLive, cardioRosterLive, { cleanN: 104, warnN: 8, violN: 6 });
// Micro lab safety live (override roster 40; 30 online, ending soon)
const microRoster = q.all(`SELECT student_id FROM exam_roster_overrides WHERE exam_id = ?`, microLive).map((r) => r.student_id);
liveAttempts(microLive, microRoster.slice(0, 33), { cleanN: 27, warnN: 3, violN: 3, startedMinSpread: 90 });

// ---- historical violations (Top Violation Types chart, last 7 days) --------
const VIOL_MIX = ['tab_blur', 'tab_blur', 'tab_blur', 'tab_blur', 'tab_blur', 'tab_blur', 'tab_blur', 'tab_blur',
  'right_click', 'right_click', 'right_click', 'right_click', 'right_click',
  'devtools', 'devtools', 'devtools', 'copy_paste', 'copy_paste', 'print_screen'];
const histAttempts = q.all(
  `SELECT a.id FROM attempts a JOIN exams e ON e.id = a.exam_id
   WHERE a.status = 'submitted' AND a.started_at >= ? ORDER BY a.id`, iso(NOW - 7 * DAY)
);
let vi = 0;
for (const row of histAttempts) {
  if (vi >= VIOL_MIX.length) break;
  if (rand() < 0.12) {
    insViolation.run(row.id, VIOL_MIX[vi], '', 1, iso(NOW - between(1, 6) * DAY));
    q.run(`UPDATE attempts SET violations_count = 1 WHERE id = ?`, row.id);
    if (rand() < 0.4 && vi + 1 < VIOL_MIX.length) {
      vi++;
      insViolation.run(row.id, VIOL_MIX[vi], '', 2, iso(NOW - between(1, 6) * DAY + 60000));
      q.run(`UPDATE attempts SET violations_count = 2 WHERE id = ?`, row.id);
    }
    vi++;
  }
}

// ---- AI review queue content -------------------------------------------------
const insGen = db.prepare(
  `INSERT INTO ai_generations (course_id, exam_id, note_id, kind, payload_json, status, created_at) VALUES (?,?,?,?,?,'pending',?)`
);
const AI_MCQS = [
  ['During isovolumetric ventricular contraction, which valves are open?', ['None — all valves are closed', 'AV valves only', 'Semilunar valves only', 'All valves'],
    'Isovolumetric = volume constant, so both AV and semilunar valves are closed.'],
  ['The QRS complex on an ECG corresponds to…', ['Ventricular depolarization', 'Atrial depolarization', 'Ventricular repolarization', 'AV nodal delay']],
  ['Which change would strongest increase cardiac output acutely?', ['Rise in heart rate from 60 to 100 bpm', 'A 1% fall in contractility', 'Lower venous return', 'Increased vagal tone']],
  ['First-pass metabolism primarily occurs in the…', ['Liver', 'Kidney', 'Lung', 'Stomach']],
  ['A competitive antagonist shifts the dose–response curve…', ['Rightward without lowering the maximum', 'Downward', 'Leftward', 'Unchanged']],
];
const AI_ESSAYS = [
  ['Using the pressure–volume loop, explain how increased afterload affects stroke work.', 'Model: loop shifts: higher aortic pressure needed to open aortic valve → smaller SV, larger ESV, increased stroke work area.'],
  ['Outline how beta-blockers improve survival in chronic heart failure.', 'Model: reduce maladaptive sympathetic drive, lower HR/contractility acutely but improve remodeling; reduce arrhythmias.'],
  ['Explain why Km is unchanged but Vmax falls in pure non-competitive inhibition.', 'Model: inhibitor binds elsewhere, reduces active enzyme pool; remaining enzyme has same affinity so Km unchanged.'],
];
for (const [t, o, rat] of AI_MCQS) {
  insGen.run(courses.bio201, cardioLive, cardioNotes, 'mcq',
    JSON.stringify({ text: t, options: o, correct_index: 0, points: 2, rationale: rat || '' }), iso(NOW - 25 * MIN));
}
for (let i = 0; i < 3; i++) {
  insGen.run(courses.bio201, null, cardioNotes, 'mcq',
    JSON.stringify({ text: `Auto-generated check ${i + 1} from notes`, options: ['Correct option', 'Distractor B', 'Distractor C', 'Distractor D'], correct_index: 0, points: 2 }), iso(NOW - 25 * MIN));
}
for (const [t, m] of AI_ESSAYS) {
  insGen.run(courses.bio201, cardioLive, cardioNotes, 'essay',
    JSON.stringify({ text: t, model_answer: m, rubric: 'Key points coverage (60%), correct terminology (25%), clarity (15%).', points: 10 }), iso(NOW - 25 * MIN));
  insGen.run(courses.bio201, cardioLive, cardioNotes, 'rubric',
    JSON.stringify({ question: t, rubric: 'Key points coverage (60%), correct terminology (25%), clarity (15%).' }), iso(NOW - 25 * MIN));
}

// ---- flagged questions (quality alerts) --------------------------------------
for (const qid of q.all(`SELECT id FROM questions WHERE exam_id IN (?,?) ORDER BY id DESC LIMIT 3`, renalQuiz, microLive).map((r) => r.id)) {
  q.run(`UPDATE questions SET flagged = 1 WHERE id = ?`, qid);
}

// ---- presence samples (Live Overview sparkline, today 08:00 → now) ----------
let t0 = new Date(); t0.setHours(8, 0, 0, 0);
const sampleStart = Math.max(t0.getTime(), NOW - 7 * HOUR);
for (let t = sampleStart; t <= NOW; t += 12 * MIN) {
  const frac = (t - sampleStart) / Math.max(1, NOW - sampleStart);
  const n = Math.round(45 + 60 * Math.sin(frac * Math.PI * 1.6) * between(0.5, 1) + frac * 40 + between(-8, 8));
  q.run(`INSERT INTO presence_samples (ts, online_count) VALUES (?,?)`, iso(t), Math.max(20, n));
}

// ---- audit / activity feed ---------------------------------------------------
const insAudit = db.prepare(
  `INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, meta_json, created_at) VALUES (?,?,?,?,?,?,?)`
);
insAudit.run('teacher', john, 'exam.created', 'exam', cardioLive, JSON.stringify({ title: 'Cardiology Final Exam', course: 'BIO 201' }), iso(NOW - 2 * MIN));
insAudit.run('teacher', john, 'roster.csv_imported', 'course', courses.bio201, JSON.stringify({ added: 15, exam: 'Pharmacology Midterm' }), iso(NOW - 10 * MIN));
insAudit.run('teacher', john, 'ai.questions_generated', 'course', courses.bio201, JSON.stringify({ from: 'notes', exam: 'Anatomy Quiz 2' }), iso(NOW - 25 * MIN));
insAudit.run('teacher', john, 'results.published', 'exam', biochemLab - 0, JSON.stringify({ title: 'Biochemistry Lab Test' }), iso(NOW - 1 * HOUR));
insAudit.run('system', null, 'exam.auto_submitted', 'attempt', null, JSON.stringify({ reason: 'Multiple violations detected' }), iso(NOW - 1 * HOUR));

console.log('Seed complete.');
console.log('────────────────────────────────────────────────————');
console.log('Teacher login:   john.doe@exampro.edu / demo1234');
console.log('Co-teacher:      mark.rivera@exampro.edu / demo1234');
console.log('TA:              alice.chen@exampro.edu / demo1234');
console.log('Admin:           admin@exampro.edu / admin1234');
console.log('Student (live):  roll STU-1001, access code CARD-7291');
console.log('Student (done):  roll STU-1121, access code ANAT-1103 (released results)');
console.log('────────────────────────────────────────────────────');
