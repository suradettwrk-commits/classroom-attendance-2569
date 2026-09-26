# GEMINI GRAVITY PROMPT — Classroom Attendance System 2569

เอกสารนี้เป็นข้อกำหนดและแนวทางการปฏิบัติการขั้นสูงสุด (Master Operational Prompt) สำหรับ Gemini และ Antigravity AI ในการดูแล ตรวจสอบ ซ่อมแซม และพัฒนาระบบจัดการชั้นเรียน เช็คชื่อ และเช็คงาน (Classroom Attendance 2569)

---

## 1. ขอบเขตและเป้าหมายของระบบ (System Mission)
- **ระบบ:** เว็บแอปพลิเคชันจัดการชั้นเรียน บันทึกเวลาเรียน (เช็คชื่อ) บันทึกคะแนน และประเมินผลการเรียน
- **Frontend / Static Host:** GitHub Pages (`https://suradettwrk-commits.github.io/classroom-attendance-2569/`)
- **Backend / Authentication:** 
  - **Supabase Auth (PKCE):** ยืนยันตัวตนผ่าน Google OAuth ด้วย REST + PKCE Flow
  - **Supabase Edge Function (`score-api`):** จัดการ API สำหรับ Bootstrap, Dashboard, Profile, โหลดคะแนน (load) และบันทึกคะแนน (save)
  - **Firebase Realtime Database Bridge:** เลเยอร์ความเข้ากันได้ชั่วคราวและ source of truth ในช่วงเปลี่ยนผ่าน
- **Repository:** `https://github.com/suradettwrk-commits/classroom-attendance-2569.git` (Branch: `main`)

---

## 2. กฎเหล็กความปลอดภัยและข้อห้ามเด็ดขาด (Invariants & Safety Rules)

### กฎข้อที่ 1: ตรวจสอบ Identity, Email และ Role อย่างเคร่งครัด (ห้ามข้าม)
- ลำดับขั้นตอนการตรวจสอบสิทธิ์ (End-to-End Auth Chain):
  `Google OAuth → Supabase Auth/PKCE → ตรวจ email/profile/role → เปิดหน้า Admin → โหลด Dashboard/คะแนน → CRUD`
- อีเมลที่ผ่านการรับรองจาก Google / Supabase (`authEmail` หรือ `window.__AUTH_EMAIL`) ต้องตรงกับข้อมูลโปรไฟล์ผู้ใช้ (`CURRENT_USER.email`)
- ไม่อนุญาตให้ใช้ Anonymous session หรือ session ที่อีเมลไม่ตรงกันในการเขียนข้อมูล (`SCORE`, `ATTENDANCE`, `STUDENT_STATUS`)
- รายชื่ออีเมลผู้ดูแลระบบ (Admin Allowlist):
  - `suradet.t@wrk.ac.th`
  - `suradett.wrk@eisth.org`
  ทั้งสองอีเมลต้องได้รับสิทธิ์ Admin เต็มรูปแบบ ทั้งใน Edge Function, Frontend (`index.html`, `admin.html`) และ Compatibility Bridge (`firebase-bridge.js`)

### กฎข้อที่ 2: ห้ามลบหรือเขียนทับข้อมูลจริง (Zero Destructive Overwrite)
- ห้ามลบ แก้ทับ หรือ migrate ข้อมูลจริงใน `students`, `assignments`, `scores`, `attendance`, `terms`, `teacherClasses`
- ห้ามแก้ไข `StudentID`, `AssignmentID`, `ScoreID`, `RecordID` หรือคะแนนดิบเดิม
- การแก้ไขสถานะนักเรียนทำได้เฉพาะฟิลด์ `Status` และ metadata ที่กำหนดเท่านั้น
- การเขียนข้อมูลต้องมี Idempotency Key ป้องกัน duplicate writes และต้องยืนยันผลตอบกลับจาก server ก่อนเคลียร์คิว

### กฎข้อที่ 3: ห้ามใช้ Timestamp เป็น TermID (Canonical TermID Rule)
- `TermID` ต้องเป็นรหัสคงที่ถาวร เช่น `AY2569_T1` หรือ `2569_1`
- **ห้าม** นำวันเวลาหรือ ISO string (เช่น `2026-09-25T...`) มาใช้เป็น `TermID` เด็ดขาด
- ในหน้าจอ UI สามารถแสดง label เช่น `1/2569` ได้ แต่ internal key ต้องเป็น canonical ID

### กฎข้อที่ 4: Backend Data Routing ต้องสอดคล้องกัน (No Split-Brain Reads/Writes)
- เมื่อใช้งานผ่าน Supabase Auth การอ่านคะแนน (`loadScoresGrid`) และการบันทึกคะแนน (`saveScoresBatch`) ต้องมุ่งตรงไปยัง Supabase `score-api` เดียวกัน
- ห้ามบันทึกไปที่ Supabase แต่กลับไปอ่านคะแนนจาก Firebase ซึ่งทำให้ดูเหมือนคะแนนที่บันทึกหายไป

### กฎข้อที่ 5: ไม่สรุปว่าสำเร็จจนกว่าจะทดสอบหน้าเว็บ Production จริง
- ห้ามอ้างอิงความสำเร็จจากการ build, lint หรือ commit เพียงอย่างเดียว
- ต้องทำการทดสอบผ่าน URL Production จริง (`https://suradettwrk-commits.github.io/classroom-attendance-2569/`)
- ตรวจสอบ Console logs และ Network responses ว่าไม่มีข้อผิดพลาด `PERMISSION_DENIED`, Auth timeout, หรือ 401/403

---

## 3. ขั้นตอนการตรวจสอบและพัฒนา (Standard Operating Procedure)

1. **Pre-flight & Inspection:**
   - ตรวจสอบ Git status, branch (`main`) และ remote (`origin/main`)
   - อ่าน `PROJECT_RULES.md`, `PROJECT_HANDOFF.md` และ `Rules.md`
2. **Implementation:**
   - แก้ไขเฉพาะ Source files ที่ root directory (`index.html`, `admin.html`, `firebase-bridge.js`, `supabase-score-client.js`, `supabase-auth-client.js`, `supabase/functions/score-api/index.ts`)
   - ห้ามแก้ไขไฟล์ในโฟลเดอร์ `docs/` โดยตรง
3. **Build & Quality Checks:**
   - รัน Safety check: `node scripts/repository-safety-check.js`
   - รัน Syntax check:
     - `node --check firebase-bridge.js`
     - `node --check supabase-score-client.js`
     - `node --check supabase-auth-client.js`
   - คอมไพล์ static pages: `node build-github-pages.js`
   - ตรวจสอบ `git diff` ให้แน่ใจว่าไม่มี secret หรือไฟล์แปลกปลอมถูก stage
4. **Deploy & Live Verification:**
   - Commit ด้วยคำอธิบายที่ชัดเจน และ Push ไปยัง `origin/main`
   - รอ GitHub Actions Pages workflow ทำการ deploy
   - ทำ Browser smoke test บน Production URL ตรวจสอบ:
     - Google OAuth / Supabase Auth flow
     - Profile lookup & role authorization
     - Term selection & Class options
     - Admin dashboard metrics
     - Scores load & save (CRUD verification)

---

## 4. โครงสร้างรายงานสรุปผลงาน (Final Report Requirements)
เมื่อเสร็จสิ้นภารกิจ ต้องรายงาน 4 ส่วนสำคัญต่อไปนี้เสมอ:
1. **Root Cause Analysis:** สาเหตุที่แท้จริงของปัญหาที่พบ
2. **Changed Files:** รายการไฟล์ที่ได้รับการแก้ไข พร้อมคำอธิบายการเปลี่ยนแปลง
3. **Commit & Deploy SHA:** หมายเลข Git Commit และผลการ deploy บน GitHub Pages
4. **Data & System Verification Results:** ผลการตรวจสอบการทำงานของระบบและข้อมูลจริงแบบ end-to-end
