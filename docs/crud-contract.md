# CRUD contract

## Identity

API ต้องรับ identity จาก Supabase Auth และตรวจอีเมล/role/scope ที่ server ห้ามเชื่อ `CURRENT_USER` จาก client เพียงอย่างเดียว

## Create / update

- ใช้ stable primary key เดิมเมื่อเป็นข้อมูล legacy
- คะแนน update ต้องเป็น merge เฉพาะ field ที่แก้ ไม่เขียนทับ record ทั้งก้อนโดยไม่อ่านค่าปัจจุบัน
- ทุก write ระบุ `TermID`; คะแนนระบุ `AssignmentID` และ `StudentID`
- retry ต้อง idempotent และไม่สร้างคะแนนซ้ำ

## Read

- query ต้องมี term scope
- ผลลัพธ์ต้องแยก `data`, `errors`, `meta` และระบุ source/version
- empty result ต้องแยกจาก loading/error ห้ามแสดงเป็นข้อมูล 0 โดยไม่มีสถานะ

## Delete

- ห้าม hard-delete คะแนน/เช็คชื่อเดิมระหว่าง migration
- ใช้สถานะหรือ audit trail เมื่อจำเป็น
- การลบต้องผ่าน role และ scope policy
