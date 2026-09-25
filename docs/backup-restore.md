# Backup and restore runbook

## ก่อนเปลี่ยน schema หรือ source of truth

1. Export Firebase แบบ read-only
2. เก็บ rules/config แยกจาก data export
3. คำนวณ SHA-256 ของไฟล์ backup
4. สร้าง manifest จำนวนแถวของ `terms`, `students`, `assignments`, `scores`, `attendance`
5. รัน `node scripts/firebase-backup-verify.js <backup.json>`
6. เก็บรายงาน unresolved terms/orphans/conflicts

## Restore principle

ห้าม restore ทั้งฐานทับ production เพื่อแก้ปัญหา UI ให้ restore เฉพาะ path/ช่วงเวลาที่ระบุ และต้องตรวจ diff ก่อนเขียนทุกครั้ง

## Required evidence

- backup path และ timestamp
- SHA-256
- counts ก่อน/หลัง
- score count และ non-blank score count
- orphan/conflict report
- ผู้อนุมัติและผล browser smoke test
