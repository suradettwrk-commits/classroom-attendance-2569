# Technical System Context — Classroom Attendance 2569

เอกสารอ้างอิงสถาปัตยกรรมทางเทคนิคและบริบทระบบ สำหรับการบำรุงรักษาและพัฒนาระบบ Classroom Attendance 2569

---

## 1. ภาพรวมสถาปัตยกรรม (System Architecture)

```
[ Browser Client (GitHub Pages) ]
       │
       ├── Google OAuth (PKCE Flow) ──► [ Supabase Auth ]
       │                                       │
       │                                 Access Token
       │                                       ▼
       ├── Score & Dashboard API ─────► [ Supabase Edge Function: score-api ]
       │                                       │
       │                                PostgreSQL Tables
       │                                (terms, students, assignments, scores, teacher_classes)
       │
       └── Legacy / Read-Only Bridge ─► [ Firebase Realtime Database ]
                                        (Transition backup source of truth)
```

---

## 2. ข้อมูลการยืนยันตัวตนและบัญชีผู้ดูแลระบบ (Identity & Admin Accounts)

### ผู้ดูแลระบบที่ได้รับอนุญาต (Authorized Admins)
- `suradet.t@wrk.ac.th` (สุรเดช ธรรมประโชติ)
- `suradett.wrk@eisth.org` (สุรเดช ธรรมประโชติ)

### โครงสร้าง Profile ผู้ใช้
```json
{
  "id": "admin",
  "username": "suradet.t",
  "name": "สุรเดช ธรรมประโชติ",
  "email": "suradet.t@wrk.ac.th",
  "role": "admin",
  "status": "Active"
}
```

### การตรวจสอบสิทธิ์ในระบบ
1. **Frontend Session Check (`index.html`):**
   - เมื่อ login สำเร็จ ตรวจสอบ `window.__SUPABASE_AUTH_USER.email` เทียบกับรายชื่อ Admin
   - โหลดโปรไฟล์จาก `score-api` (action: `profile`) เพื่อรับ role
   - บันทึก `CURRENT_USER` ใน `localStorage` และตั้ง `window.__AUTH_EMAIL`
2. **Write Identity Verification (`admin.html`):**
   - ฟังก์ชัน `hasVerifiedWriteIdentity()` ตรวจสอบว่า session ปัจจุบันเป็นบัญชีที่ได้รับอนุญาต
   - ป้องกันไม่ให้ Sync Engine ส่งข้อมูลคะแนนผ่าน Anonymous หรือ Unverified session

---

## 3. สัญญาโครงสร้างข้อมูลและรหัสหลัก (Canonical Identifiers Contract)

| รหัสระบุ (ID) | คำอธิบาย | ตัวอย่างรูปแบบที่ถูกต้อง | รูปแบบที่ไม่อนุญาต |
| :--- | :--- | :--- | :--- |
| **`TermID`** | รหัสภาคเรียนถาวร | `AY2569_T1`, `2569_1` | ❌ ห้ามใช้ Timestamp เช่น `2026-09-25T14:30:00Z` |
| **`ClassID`** | ขอบเขตห้องเรียน | `CLASS_TERM_2569_1_ม.2_9` | ❌ ห้ามเดาหรือปล่อยว่าง |
| **`TeacherClassID`** | ผูกครู-วิชา-ห้อง-เทอม | `AY2569_T1_T101_ว22101_ม.2_9` | ❌ ห้ามเปลี่ยนคีย์ที่มีคะแนนผูกอยู่ |
| **`StudentID`** | รหัสนักเรียน | `34892` | ❌ ห้ามแก้ไขหรือเขียนทับ |
| **`AssignmentID`** | รหัสชิ้นงาน | `ASN_2569_T1_001` | ❌ ห้ามเปลี่ยน |
| **`ScoreID`** | รหัสคะแนน | `SC_{AssignmentID}_{StudentID}` | ❌ ห้ามเปลี่ยน |

---

## 4. ข้อกำหนด API (Supabase `score-api` Edge Function)

- **Endpoint:** `https://jvyxnsokfpnepshyyzpg.functions.supabase.co/score-api`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <Supabase_Access_Token>`
- **Actions:**
  1. `bootstrap`: โหลดรายการ Term ทั้งหมด และข้อมูลตั้งต้น
  2. `dashboard`: โหลดตัวชี้วัด สรุปจำนวนนักเรียน ห้องเรียน และงานตามเทอม
  3. `profile`: ค้นหาข้อมูลโปรไฟล์ผู้ใช้จากอีเมล (ส่งคืน role, name, status)
  4. `load`: โหลดตารางคะแนนนักเรียนและงานที่ scope ตาม `term`, `subjectCode`, `level`, `room`
  5. `save`: บันทึกชุดคะแนน (`scores`) โดยตรวจสอบความถูกต้องของ Assignment และ Student พร้อมส่งผลลัพธ์กลับ

---

## 5. การทำงานของคะแนน (Score Synchronization Flow)

1. ครูหรือแอดมินแก้ไขคะแนนในตาราง
2. ระบบบันทึกลง local memory และส่งคำขอผ่าน `google.script.run.saveScoresBatch`
3. Proxy ใน `supabase-score-client.js` สกัดคำขอและเรียก API ไปที่ Supabase `score-api`
4. เมื่อ server ตอบกลับว่า `success: true`:
   - คิวใน `SYNC_ENGINE` จะทำเครื่องหมายว่า synced สำเร็จ
   - UI แสดงสถานะ "บันทึกเรียบร้อย"
5. เมื่อโหลดข้อมูลใหม่ (`SCORES_MANAGER.fetchData()`):
   - หากตรวจพบ `window.__SUPABASE_AUTH_USER` ระบบจะเรียกผ่าน `google.script.run.loadScoresGrid` เพื่ออ่านจาก Supabase โดยตรง
   - ทำให้ข้อมูลที่บันทึกตรงกัน ไม่เกิดปัญหาคะแนนหายจากการสลับ backend
