# Handoff: งานทำให้ระบบนิ่งและลื่นไหล

> **สถานะอ้างอิงปัจจุบัน — 27 กันยายน 2569**
>
> ให้อ่านส่วนนี้ก่อนทุกครั้ง ส่วนบันทึกด้านล่างเป็นประวัติการแก้ไขเดิมและอาจมีสถานะที่ล้าสมัย ห้ามย้อนกลับไปทำซ้ำหรือสรุปจากข้อความเก่าโดยไม่เทียบกับส่วนนี้
>
> **ผลลัพธ์ล่าสุด: RELEASED / DEPLOYED / STABLE**
>
> - ฐาน release คือ `origin/main` ของ `https://github.com/suradettwrk-commits/classroom-attendance-2569.git`
> - commit ล่าสุดที่ deploy คือ `c380c1c fix fast shared write paths and grading settings term`
> - push ไป `origin/main` สำเร็จแบบ fast-forward ปกติจาก `1f5ad81` เป็น `c380c1c`
> - ห้ามใช้ Force Push และห้ามนำ branch `main` ใน OneDrive ที่ประวัติแยกกันมาผสานทับ release โดยตรง
> - GitHub Actions `Deploy GitHub Pages #59` ผ่าน และ `pages-build-deployment #73` ผ่าน
> - Production URL: `https://suradettwrk-commits.github.io/classroom-attendance-2569/`
> - รายงานสำรองฉบับนี้: `RELEASE_STATUS_REPORT_2026-09-27.md`
> - สถานะใช้งาน: ระบบหลักอ่าน/เขียน/ซิงก์ได้จริงและนิ่งดีมากจากหลักฐานที่ตรวจแล้ว
> - Scores ใช้ `SYNC_ENGINE`; Grading ใช้ pipeline แยกโดยตั้งใจ เพื่อคุม batch, conflict, retry และ settings `term_id` ไม่ให้ปะปนกัน
> - ยังไม่ควรรวม queue สองส่วนจนกว่าจะมีคำสั่งใหม่และมี contract test รองรับ
>
> **ขอบเขตที่ยืนยันแล้ว**
>
> - แก้เฉพาะเส้นทางโหลด Scores ที่ช้า/ค้างใน Supabase static build ด้วย bounded direct read: terms → students/assignments → scores ของ assignment ที่เลือก
> - คง Firebase realtime path ไว้สำหรับ legacy build; Supabase ไม่ใช้ compatibility listener เป็นเส้นทางแรก
> - ไม่เปลี่ยนแนวทาง UX/UI, CSS, layout หรือ print; ห้ามปรับหน้าตา/interaction เดิมโดยไม่มีคำสั่งผู้ใช้
> - ไม่เปิดตรวจหรือแก้ `admin.html?verify=20260927-admin` ซ้ำ เพราะเป็นหน้าทดสอบที่เคยแสดงผลเพี้ยนและอยู่นอกขอบเขตการแก้ Scores
>
> **หลักฐาน acceptance ล่าสุด**
>
> - Local + Supabase จริง: Student, Attendance, Scores, Grading ผ่านแบบ read-only
> - Student/Attendance/Grading แสดงเลขที่ 1–40 ถูกต้อง; Scores Production แสดง 7 งาน, 40 คน, ลำดับ 1–40 และไม่มี `undefined`
> - Production Scores: `1/2569 / ส22101 / ม.2 / ห้อง 8` โหลดข้อมูลได้จริง ไม่ค้าง spinner
> - admin `suradet.t@wrk.ac.th` และครู `suradett.wrk@eisth.org` ผ่าน active staff/RLS identity check
> - settings CRUD ของ admin/ครูทดสอบด้วย transaction + rollback แล้ว และตรวจหลัง rollback ไม่เหลือ probe rows
> - mapping 26 รายการที่มี single candidate ทำแล้ว; quarantine 4 รายการยังคง NULL ตามหลักความปลอดภัย ห้ามเดาและเติมเพิ่ม
>
> **สิ่งที่ต้องทำต่อเมื่อมีงานใหม่เท่านั้น**
>
> 1. อ่านไฟล์นี้และตรวจ `git status`, `git log`, `origin/main` ก่อนแก้เสมอ
> 2. เปลี่ยนเฉพาะ scope ที่ผู้ใช้ระบุ; ห้าม refactor ใหญ่หรือปรับ UX/UI เพียงเพราะ local ต่างจาก production
> 3. งาน read ใช้ read-only เป็นค่าเริ่มต้น; งาน write ต้องมีคำสั่งชัดเจนและใช้ transaction/rollback หรือ test namespace ที่ปลอดภัย
> 4. ก่อน commit รัน syntax, repository/release/UI contracts และ `git diff --check`; build `docs/` ให้ตรง source
> 5. commit บนฐาน `origin/main`, push แบบปกติเท่านั้น แล้วรอ Actions ตรวจ Production แบบ read-only
> 6. หากพบความต่างระหว่าง local กับ production ให้หยุดและรายงานความต่างก่อนแก้ อย่าสรุปว่าเป็นเหตุให้ต้องเปลี่ยน UI
>
> **ห้ามทำซ้ำโดยไม่มี source เปลี่ยนหรือผู้ใช้สั่ง**: ตรวจ login/ทุกแท็บซ้ำทั้งหมด, mapping/quarantine ที่ผ่านการตัดสินใจแล้ว, CRUD จริงแบบเขียนค้าง, force push, reset/checkout ทับไฟล์ผู้ใช้, และการเพิ่มข้อมูลทดลองในฐานข้อมูลจริง

วันที่ส่งต่องาน: 26 กันยายน 2569

## Work log — 27 กันยายน 2569

ตรวจ URL deploy จริง `https://suradettwrk-commits.github.io/classroom-attendance-2569/` หลัง reload พบว่า session เปิดได้ แต่ Scores dropdown ว่างและ console มี `SUPABASE_READ_SKIPPED:assignments ... statement timeout` จึงยืนยันว่า production ยังไม่เสถียร แม้หน้าเว็บจะเปิดได้

ตรวจ Supabase staging แบบ read-only แล้วพบ canonical term `AY2569_T1` (label `1/2569`), assignments 88 และ students 3152 พร้อม index activity และ RLS policies ครบ SELECT/INSERT/UPDATE/DELETE

แก้บน worktree ที่ตรงกับ `origin/main`:

- Supabase mode ไม่รอ Firebase auth persistence ก่อนอ่านข้อมูล
- scope `students` ด้วย canonical `term_id` เช่นเดียวกับ activity tables
- assignment bootstrap ใช้ fallback projection ที่เล็กลงเมื่อ projection หลักล้ม
- dashboard route ส่ง `term/date/user` context เดิมครบ ไม่ห่อ object ซ้ำ
- เพิ่ม `esc()` กลางใน `admin.html`

ผล local release-candidate จาก build ล่าสุด:

- Google callback/session restore: ผ่าน
- dashboard: 319 นักเรียน, 63 งาน, term summary แสดงผล
- subject/level/room dropdown ของ attendance, scores, grading: มีข้อมูลและเลือกค่าได้
- console error/warning functional: ไม่พบในการ clean session
- syntax/repository contract/diff check: ผ่าน

รอบ acceptance ล่าสุดพบข้อค้างใหม่ที่ต้องแก้ก่อนสรุปว่า release candidate ผ่าน:

- หลังเปิด Scores ด้วย `S22101 / ม.2 / 8` แล้วรอเกิน 30 วินาที ตารางยังค้าง `กำลังโหลดข้อมูล...` โดยไม่มี `error` หรือ `warn` ใน browser console; dropdown มีข้อมูลแล้ว แต่ score grid ยังไม่ render จึงยังไม่ผ่าน
- ห้ามสรุป score read ผ่านจนกว่าจะเห็นรายชื่อนักเรียน/คอลัมน์งานจริง หรือแสดง error state ที่กู้คืนได้แทน spinner ค้าง
- รอบนี้ไม่พบการแก้ CSS และไม่แตะ logic การพิมพ์

### Baseline correction (27 กันยายน 2569)

- ห้ามใช้ candidate นี้เป็น UX/UI baseline ต่อ: สร้างจาก `origin/main` ซึ่งมี commit `d11f828` เปลี่ยนจาก Tailwind CDN เป็น static `tailwind.css` และทำให้ `admin.html`/`index.html` ต่างจาก worktree ที่ผู้ใช้กำลังใช้งานอยู่หลายส่วน
- ผู้ใช้ยืนยันว่าหน้าตาและ interaction เดิมต้องคงเดิม แม้ทดสอบ local หรือเตรียม deploy ดังนั้นงานถัดไปต้องสร้าง candidate จาก UI baseline เดิม แล้ว cherry-pick/นำเข้าเฉพาะ data/term/CRUD fixes ที่จำเป็น ห้ามนำ CSS/layout refactor จาก `origin/main` มาปน
- Worktree นี้จึงเป็นเพียงหลักฐานวิเคราะห์ branch ล่าสุด ไม่ใช่ release source จนกว่าจะทำ baseline comparison และยืนยันหน้าจอเทียบกับ deploy/ไฟล์เดิม

ยังไม่ใช่ production deployment: changes ยัง uncommitted และยังต้องผ่าน CRUD write/RLS, admin/no-access, orphan/mapping/integrity gates ก่อน push

## เป้าหมายเดิม

ทำระบบจัดการชั้นเรียนให้ใช้ Supabase Auth ต่อไป แต่ทำให้ทุกแท็บใช้เส้นทางข้อมูลเดียวกัน:

```text
Auth → term_id → permission → repository → CRUD → UI state
```

ห้ามลบหรือเขียนทับข้อมูลจริง และยังไม่ควร commit, push หรือ deploy จนกว่าการตรวจ Local Test และ production build จะผ่านครบ

## ตำแหน่งงานปัจจุบัน

กำลังทำงานใน release worktree นี้:

```text
/Users/edwardtam/.codex/worktrees/supabase-stability-release/ระบบจัดการชั้นเรียน ใหม่ 2569
```

อย่าสับสนกับโปรเจกต์ต้นฉบับที่อยู่ใน OneDrive ซึ่งมีไฟล์ของผู้ใช้ที่ไม่เกี่ยวข้องอยู่แล้ว

Backup ข้อมูลสำหรับ Local Test:

```text
/Users/edwardtam/Library/CloudStorage/OneDrive-ส่วนบุคคล/Edward/Code/2569/ระบบจัดการชั้นเรียน_เช็คชื่อ_เช็คงาน/ระบบจัดการชั้นเรียน ใหม่ 2569/_BACKUP_FIREBASE_LIVE_20260925_1030.json
```

## สิ่งที่ทำแล้ว

### 1. สัญญา term

- เพิ่ม/ปรับ canonical term resolution ใน `firebase-bridge.js` และ `supabase-compat.js`
- ไม่สร้าง synthetic key เช่น `TERM_2569_1`
- ใช้ `TermID` ที่มีอยู่ในฐานข้อมูลเป็น persisted key
- รองรับการแสดงผล `1/2569` เป็น label ของ UI
- ตรวจ backup แล้วพบข้อมูลหลักใช้ term timestamp `2568-12-31T16:59:56.000Z` และข้อมูล attendance เดิมใช้ label `1/2569`
- เพิ่ม `scripts/verify-term-contract.js`

### 2. Permission และ repository กลาง

ใน `firebase-bridge.js` เพิ่ม `classroomRepository` และ routing หลักของ UI ให้ผ่าน repository กลาง ได้แก่:

- `getAllowedScopes`
- `getStudents`
- `getAssignments`
- `getAttendance`
- `getScoreGrid`
- `getGradingRoster`
- `saveAttendance`
- `saveScores`
- `saveScore`
- `saveGrades`

เส้นทาง UI ที่ถูก route แล้ว ได้แก่ `getStudentsByFilter`, `getAttendanceForCheck`, `loadScoresGrid`, `getGradingData`, `getDashboardStats`, `getInitialDropdowns`, `saveAttendance`, `saveScoresBatch`, `saveGradingBatch`

เพิ่ม `scripts/verify-repository-contract.js`

### 3. Auth

- คง Supabase Auth ไว้
- ใน Supabase mode ไม่สร้าง anonymous Firebase identity ปลอม
- เพิ่มการอ่าน profile จาก `app_users`
- ตรวจ `user_id/teacher_id`, role และ status ก่อนเขียนข้อมูล
- ยังมี compatibility transport ชื่อ `firebase-bridge.js` เพราะเป็นสะพานของโค้ดเดิม ห้ามลบทิ้งจนกว่าจะตรวจทุกแท็บครบ

### 4. หน้าเช็คชื่อ

ใน `firebase-bridge.js` ปรับ `getAttendanceForCheck` ให้คืน “roster นักเรียนเต็มห้อง” แล้ว merge attendance ของวันที่เลือก แทนการคืนเฉพาะแถวที่เคยบันทึกไว้ ทำให้วันที่ยังไม่มีการเช็คชื่อไม่กลายเป็น `0 คน`

ใน `admin.html`:

- กดสถานะเดิมซ้ำจะคำนวณเป็นค่าว่าง เพื่อรองรับการ clear
- สถานะถูกเขียนลง state/cache แบบ optimistic
- หลัง enqueue มีการ render ใหม่เพื่อให้ radio state สะท้อนค่าปัจจุบัน
- callback หลัง sync อ่าน `rec.status` จริง ไม่บังคับแสดงสีเขียวเมื่อ status เป็นค่าว่าง
- รายชื่อ roster จาก server เรียงตามเลขที่นักเรียนใน `firebase-bridge.js`
- ปรับ `loader.html` ให้ empty local attendance ไม่หยุดอยู่กับข้อมูลว่างทันที

### 5. ผลตรวจที่ผ่านแล้ว

คำสั่งเหล่านี้ผ่านใน release worktree ก่อนการแก้ล่าสุด:

```bash
npm run test:syntax
npm run test:repository-contract
node scripts/verify-term-contract.js "/path/to/_BACKUP_FIREBASE_LIVE_20260925_1030.json"
git diff --check
```

ผลสำคัญจาก term verifier:

- assignments 88 แถว ตรวจ term ได้ครบ
- attendance 803 แถว ตรวจ term ได้ครบ
- scores 3528 แถว ตรวจ term ได้ครบ
- students 3152 แถว ตรวจ term ได้ครบ
- subjects 6 แถว ตรวจ term ได้ครบ
- ไม่พบ missing term refs หรือ synthetic term refs

Local Test build สำเร็จล่าสุดด้วย:

```bash
node build-local-test.js "/Users/edwardtam/Library/CloudStorage/OneDrive-ส่วนบุคคล/Edward/Code/2569/ระบบจัดการชั้นเรียน_เช็คชื่อ_เช็คงาน/ระบบจัดการชั้นเรียน ใหม่ 2569/_BACKUP_FIREBASE_LIVE_20260925_1030.json"
```

## สิ่งที่ตรวจพบจากเบราว์เซอร์

ใช้ Chrome tab Local Test ที่ `http://localhost:4183/` และทดสอบครู auto-login:

```text
?localtest=attendance-toggle-v3&localRole=teacher&localAutoLogin=1
```

ยืนยันแล้ว:

- เลือก ส22101 → ม.2 → ห้อง 8 ได้
- โหลด roster ได้ 40 คน
- รายชื่อเรียงเป็น 1,2,3,...,40 แล้ว
- สลับวิชา/สิทธิ์เดิมใน grading และ scores เคยตรวจแล้วว่า cascade ทำงานตาม scope
- ปุ่ม “มาทั้งหมด” เปลี่ยน state เป็น “รอบันทึก” ได้จริง

## งานที่ยังต้องทำต่อทันที

### A. แก้ชื่อ CSS class สีสถานะ (ค้างอยู่จุดเดียวจากการทดสอบล่าสุด)

ใน `admin.html` renderer ใช้ `${opt.color}` ซึ่งมีค่า `green`, `yellow`, `blue`, `red` แต่ CSS ปัจจุบันยังตั้งชื่อเป็น `attendance-status-present`, `attendance-status-late`, `attendance-status-leave`, `attendance-status-absent` จึงทำให้ state เปลี่ยนแต่สีไม่ขึ้น

ให้แก้เฉพาะ 4 บรรทัดนี้เป็น:

```css
.attendance-status-option.attendance-status-green { background: #22c55e !important; }
.attendance-status-option.attendance-status-yellow { background: #facc15 !important; color: #713f12 !important; }
.attendance-status-option.attendance-status-blue { background: #60a5fa !important; }
.attendance-status-option.attendance-status-red { background: #ef4444 !important; }
```

หรือเปลี่ยน renderer ให้ส่งชื่อ `present/late/leave/absent` แต่เลือกวิธีใดวิธีหนึ่งเท่านั้น

### B. ทดสอบ toggle ให้ครบ

หลังแก้ CSS ให้ rebuild แล้วเปิด Local Test ใหม่:

```bash
node build-local-test.js "/Users/edwardtam/Library/CloudStorage/OneDrive-ส่วนบุคคล/Edward/Code/2569/ระบบจัดการชั้นเรียน_เช็คชื่อ_เช็คงาน/ระบบจัดการชั้นเรียน ใหม่ 2569/_BACKUP_FIREBASE_LIVE_20260925_1030.json"
python3 -m http.server 4183
```

ทดสอบวันที่ใหม่ที่ไม่มีข้อมูล เช่น `2026-09-27`:

1. โหลด ส22101 / ม.2 / ห้อง 8
2. กด “มา” แถวแรก → ต้องเป็นสีเขียวและขึ้น Saving/Waiting Sync
3. รอ sync → ต้องขึ้นบันทึกโดย/เวลาและสีเขียว
4. กด “มา” แถวเดิมซ้ำ → ต้องเป็นสีเทา/ไม่มีสถานะ
5. รอ sync → ต้องไม่กลับไปแสดงสีเขียว และแสดง “ยังไม่เช็ก” หรือสถานะว่าง
6. reload แล้วโหลดใหม่ → ต้องยังว่าง

ทดสอบ `สาย`, `ลา`, `ขาด` ด้วยอย่างน้อยหนึ่งรายการเพื่อยืนยันสีเหลือง/ฟ้า/แดง

### C. ตรวจ console หลัง build

ต้องตรวจว่าไม่มี error ใหม่จาก:

- `getAttendanceForCheck`
- `saveAttendance`
- `saveScoresBatch`
- `saveGradingBatch`
- term mapping
- permission rejection

คำเตือน `cdn.tailwindcss.com should not be used in production` ยังเป็น technical debt ที่มีอยู่ใน source เดิม ไม่ใช่ functional failure แต่ควรแก้ก่อน production final โดยติดตั้ง Tailwind build pipeline หรือเขียน CSS ที่ใช้จริงลง static stylesheet ห้ามอ้างว่า console สะอาดจนกว่าจะตรวจจริง

### D. ตรวจแท็บที่ผู้ใช้ระบุว่าเคยผ่านแล้ว

ห้ามเปลี่ยน behavior ที่ไม่เกี่ยวข้อง ตรวจแบบ read-only และ smoke test:

- Dashboard: term label, Term Summary, Top 5 risk ตามสิทธิ์
- Scores: assignment 7 รายการและ grid คะแนน
- Grading: เปลี่ยนวิชาแล้ว level/room ต้อง reset และโหลดชุดใหม่
- Students: จำนวนและสถานะ Active/ลาออก/พักการเรียน
- Attendance: roster, status colors, toggle, save/reload

### E. Production build และ release gate

เมื่อ Local Test ผ่านแล้วเท่านั้น:

```bash
BUILD_VERSION=supabase-stability-release-v2 node build-github-pages.js
npm run test:syntax
npm run test:repository-contract
node scripts/verify-term-contract.js "/path/to/_BACKUP_FIREBASE_LIVE_20260925_1030.json"
git diff --check
```

จากนั้นเปิด production build แบบ read-only ตรวจหน้าและ console ก่อน commit

## สถานะ Git ปัจจุบัน

ยังไม่มี commit ใหม่จากงานรอบนี้ ไฟล์ที่แก้/เพิ่มอยู่ใน worktree ได้แก่:

```text
admin.html
firebase-bridge.js
loader.html
supabase-compat.js
docs/index.html
docs/firebase-bridge.js
package.json
scripts/verify-repository-contract.js
scripts/verify-term-contract.js
```

อย่าใช้ `git reset --hard` หรือ checkout ทับไฟล์ เพราะมีการแก้หลายชั้นที่ผู้ใช้ต้องการเก็บไว้

## เกณฑ์ก่อน commit/push/deploy

ต้องมีหลักฐานครบ:

- Auth session ใช้ได้และ profile/role ตรง
- term เดียวกันทุกแท็บ
- ครูเห็นเฉพาะ scope, แอดมินเห็นครบ
- เปลี่ยนวิชาแล้ว level/room/roster เปลี่ยนตาม
- CRUD save → UI → reload ตรงกัน
- toggle attendance และ clear ทำงานจริง
- ไม่เกิด duplicate จาก queue
- console ไม่มี error functional ใหม่
- production build เปิดได้จริง

เมื่อผ่านทั้งหมด ค่อยสร้าง commit แยกที่อธิบาย scope ชัดเจน แล้วจึง push/deploy ตามสิทธิ์ที่ผู้ใช้อนุมัติไว้
