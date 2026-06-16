// Script: Import Reporting Managers from Excel into MongoDB
// Usage: node scripts/import-managers.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');

const EXCEL_FILE = path.join(process.env.USERPROFILE || 'C:/Users/Wiom', 'Downloads/Reporting Managers Report - Wiom (3).xlsx');

const employeeSchema = new mongoose.Schema({
  empId: String, name: String, email: String,
  managerName: String, managerId: String, managerSlackId: String,
  slackUserId: String,
}, { strict: false });
const Employee = mongoose.models.Employee || mongoose.model('Employee', employeeSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected');

  // Parse Excel
  const wb = XLSX.readFile(EXCEL_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { range: 1 }); // skip title row, use row 2 as header

  console.log(`📊 ${rows.length} rows found in Excel`);

  let updated = 0, skipped = 0, errors = 0;

  // Pass 1: set managerName + managerId for each employee
  for (const row of rows) {
    const empId = String(row['Employee Number'] || '').trim().toUpperCase();
    const managerName = String(row['Reporting Manager'] || '').trim();
    const managerId   = String(row['Reporting Manager Employee Number'] || '').replace('.0','').trim().toUpperCase();

    if (!empId || empId === 'NAN') { skipped++; continue; }
    if (!managerId || managerId === 'NAN') { skipped++; continue; }

    try {
      const result = await Employee.findOneAndUpdate(
        { empId },
        { $set: { managerName, managerId } },
        { new: true }
      );
      if (result) { updated++; console.log(`✅ ${empId} → Manager: ${managerName} (${managerId})`); }
      else { skipped++; console.log(`⚠️  ${empId} not found in DB — skipped`); }
    } catch (e) { errors++; console.error(`❌ ${empId}: ${e.message}`); }
  }

  console.log(`\n📌 Pass 1 done: ${updated} updated, ${skipped} skipped, ${errors} errors`);

  // Pass 2: resolve managerSlackId (find manager's slackUserId)
  let linked = 0;
  const empsWithMgr = await Employee.find({ managerId: { $exists: true, $ne: '' } }).lean();
  for (const emp of empsWithMgr) {
    if (!emp.managerId) continue;
    const mgr = await Employee.findOne({ empId: emp.managerId }).select('slackUserId name').lean();
    if (mgr?.slackUserId) {
      await Employee.updateOne({ _id: emp._id }, { $set: { managerSlackId: mgr.slackUserId } });
      linked++;
    }
  }

  console.log(`🔗 Pass 2 done: ${linked} employees ka managerSlackId linked`);
  console.log('\n✅ Manager import complete!');
  await mongoose.disconnect();
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
