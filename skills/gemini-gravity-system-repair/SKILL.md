---
name: gemini-gravity-system-repair
description: End-to-end audit, repair, and verification of Classroom Attendance System 2569 covering Google OAuth, Supabase Auth PKCE, email and role authorization, admin dashboard loading, and score CRUD integrity without data loss.
---

# Gemini Gravity System Repair Skill

คู่มือขั้นตอนการตรวจแก้และทดสอบระบบจัดการชั้นเรียน (Classroom Attendance 2569) แบบ End-to-End

## วัตถุประสงค์
เพื่อตรวจสอบ แก้ไขข้อบกพร่อง และยืนยันความถูกต้องของระบบให้พร้อมใช้งานจริงตามสายการทำงาน:
`Google OAuth → Supabase Auth/PKCE → ตรวจ email/profile/role → เปิดหน้า Admin → โหลด Dashboard/คะแนน → CRUD`

---

## 1. กฎและเงื่อนไขความปลอดภัย (Invariants & Safety)
1. **ห้ามข้ามการตรวจ Email และสิทธิ์:**
   - ตรวจสอบว่า `CURRENT_USER.email` ตรงกับ Token Email จาก Supabase / Google เสมอ
   - สิทธิ์ Admin อนุญาตสำหรับ `suradet.t@wrk.ac.th` และ `suradett.wrk@eisth.org`
2. **ห้ามลบหรือเขียนทับข้อมูลจริง:**
   - ห้ามรันสคริปต์ทำลายข้อมูลหรือล้างตารางใน Firebase, Supabase, หรือ Google Sheets
   - การแก้ไขคะแนนต้องอาศัย ID เดิม (`ScoreID`, `AssignmentID`, `StudentID`)
3. **ห้ามใช้ Timestamp เป็น TermID:**
   - ใช้เฉพาะ Canonical Term ID เช่น `AY2569_T1`, `2569_1`
4. **ห้ามสรุปว่าสำเร็จจนกว่าจะทดสอบหน้าเว็บ Production จริง:**
   - ทดสอบผ่าน Production URL (`https://suradettwrk-commits.github.io/classroom-attendance-2569/`) เสมอ

---

## 2. ขั้นตอนการตรวจสอบและซ่อมแซมระบบ (Execution Steps)

### ขั้นที่ 1: ตรวจสอบ Identity และ Authentication Chain
- **Supabase Auth PKCE:**
  - ตรวจสอบ `supabase-auth-client.js` ว่าเก็บ `code_verifier` ใน `sessionStorage` และ `localStorage` fallback อย่างถูกต้อง
  - ตรวจสอบว่าไม่เกิดการแลกเปลี่ยน authorization code ซ้ำ (`reuse __SUPABASE_AUTH_READY`)
- **Email Matching & Role Extraction:**
  - ใน `index.html`: `loadSupabaseStaffProfile()` และ `checkSession()` ต้องรองรับอีเมล Admin ทุกบัญชีใน allowlist
  - ตรวจสอบฟิลด์ `name` ในโปรไฟล์ให้แสดงชื่อ-นามสกุลที่ถูกต้อง
  - ตรวจสอบ `renderAppByRole()` ว่าผู้ใช้ที่มีอีเมลและ role ถูกต้องจะไม่ถูกเด้งออกกลับไปหน้า Login

### ขั้นที่ 2: ตรวจสอบ Write Authorization และ Sync Engine
- **Admin Write Verification:**
  - ใน `admin.html`: ฟังก์ชัน `hasVerifiedWriteIdentity()` ต้องตรวจสอบทั้ง Supabase user และ Firebase user กับรายชื่อ Admin อีเมล
  - ป้องกันไม่ให้คิว `SYNC_ENGINE` ค้างที่สถานะ `auth-wait`

### ขั้นที่ 3: ตรวจสอบ Data Flow และ Score CRUD Routing
- **Unify Read/Write Destination:**
  - เมื่อยืนยันตัวตนด้วย Supabase Auth การโหลดคะแนน (`loadScoresGrid`) ใน `SCORES_MANAGER.fetchData()` ต้องเรียกผ่าน `google.script.run.loadScoresGrid` (ซึ่งถูก proxy ไปยัง Supabase `score-api`)
  - ไม่ดึงคะแนนจาก Firebase มาทับเมื่อกำลังรันบน Supabase mode เพื่อป้องกันปัญหาคะแนนที่เพิ่งบันทึกไม่แสดงผล
- **Edge Function Support (`score-api`):**
  - Action `profile`: ส่งคืน `name`, `role`, `status` อย่างครบถ้วน
  - Action `load` & `save`: ตรวจสอบสิทธิ์ scope ตาม `TermID`, `SubjectCode`, `Level`, `Room`

### ขั้นที่ 4: Build, Safety Check และ Pre-deploy
- ตรวจสอบความปลอดภัยโค้ด:
  ```bash
  node scripts/repository-safety-check.js
  ```
- ตรวจสอบความถูกต้องของไวยากรณ์ (Syntax Check):
  ```bash
  node --check supabase-auth-client.js
  node --check supabase-score-client.js
  node --check firebase-bridge.js
  ```
- สร้าง static artifact สำหรับ GitHub Pages:
  ```bash
  node build-github-pages.js
  ```
- ตรวจสอบ `git diff` และ `git status` เพื่อความถูกต้อง

### ขั้นที่ 5: Deploy และ Production Smoke Test
- Push ขึ้น branch `main` ของ repository
- รอ GitHub Actions รัน job Pages deployment สำเร็จ
- เข้าทดสอบบน URL จริง: `https://suradettwrk-commits.github.io/classroom-attendance-2569/`
- ตรวจสอบ:
  1. การ Login ผ่าน Google และเข้าสู่ระบบ Supabase Auth
  2. การแสดงผลหน้า Admin โดยไม่เด้งออก
  3. การโหลด Dashboard metrics และตัวเลือก ภาคเรียน/วิชา/ห้อง
  4. การโหลดคะแนนนักเรียนในแท็บ `ส่งงาน/คะแนน`
  5. การทดสอบ CRUD คะแนน พร้อมการรีเฟรชหน้าจอเพื่อยืนยันว่าข้อมูลไม่สูญหาย
