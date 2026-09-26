import { createRemoteJWKSet, jwtVerify } from "npm:jose";

const PROJECT_ID = "classroom-attendance-2569";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("MIGRATION_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = new Set(["https://classroom-attendance-2569.web.app", "https://suradettwrk-commits.github.io", Deno.env.get("APP_ORIGIN") || ""].filter(Boolean));
const FIREBASE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const ADMIN_EMAILS = new Set(["suradet.t@wrk.ac.th", "suradett.wrk@eisth.org"]);
const corsFor = (request: Request) => ({ "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(request.headers.get("origin") || "") ? (request.headers.get("origin") || "") : "https://classroom-attendance-2569.web.app", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });
const json = (body: unknown, status = 200, request?: Request) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(request || new Request("https://localhost")), "Content-Type": "application/json" } });
const enc = (v: unknown) => encodeURIComponent(String(v ?? ""));
const text = (v: unknown) => String(v ?? "").trim();
const normalizeEmail = (v: unknown) => text(v).normalize("NFKC").toLowerCase();
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  return body ? JSON.parse(body) : [];
};
const rows = async (table: string, select = "*") => api(table.includes("?") ? table : `${table}?select=${select}`);
const activeTermRow = (terms: any[]) => terms.find((t) => text(t.status).toLowerCase() === "active") || terms[0];
const uiStudent = (s: any, term: any) => ({ id:s.student_id, studentId:s.student_id, no:s.student_no, prefix:s.prefix||"", first:s.first_name||"", last:s.last_name||"", firstName:s.first_name||"", lastName:s.last_name||"", name:[s.prefix,s.first_name,s.last_name].filter(Boolean).join(" "), level:s.level, room:s.room, status:s.status, term:term?.display_label||"", termId:s.term_id });
const uiSubject = (s: any, term: any) => ({ code:s.subject_code, name:s.subject_name||"", term:term?.display_label||"", termId:s.term_id, status:s.status||"", teacher:s.teacher||"" });
const uiAssignment = (a: any, term: any) => ({ id:a.assignment_id, assignmentId:a.assignment_id, title:a.title||"", maxScore:Number(a.max_score||0), subjectCode:a.subject_code, type:a.assignment_type||"", dueDate:a.due_date, level:a.level, room:a.room, term:term?.display_label||"", termId:a.term_id });
const uiClass = (c: any, term: any) => ({ id:c.teacher_class_id, teacherClassId:c.teacher_class_id, termId:c.term_id, teacherId:c.teacher_id, subjectCode:c.subject_code, level:c.level, room:c.room, status:c.status||"Active", term:term?.display_label||"" });
async function bootstrapData(auth: any) {
  const terms = await rows("terms", "term_id,term_no,academic_year,status,display_label,legacy_term_key");
  const term = activeTermRow(terms), termId = term?.term_id, filter = termId ? `&term_id=eq.${enc(termId)}` : "";
  const [subjects, students, assignments, classes, users] = await Promise.all([
    rows(`subjects?select=subject_code,subject_name,term_id,status,teacher${filter}`),
    rows(`students?select=student_id,student_no,prefix,first_name,last_name,level,room,status,term_id${filter}`),
    rows(`assignments?select=assignment_id,title,assignment_type,max_score,due_date,subject_code,level,room,status,term_id${filter}`),
    rows(`teacher_classes?select=teacher_class_id,term_id,teacher_id,subject_code,level,room,status${filter}`),
    auth.admin ? rows("app_users", "user_id,username,email,role,status") : Promise.resolve([])
  ]);
  const activeSubjects = subjects.filter((s:any) => s.term_id === termId && text(s.status).toLowerCase() !== "inactive");
  const activeStudents = students.filter((s:any) => s.term_id === termId);
  const activeAssignments = assignments.filter((a:any) => a.term_id === termId);
  const activeClasses = classes.filter((c:any) => c.term_id === termId && text(c.status).toLowerCase() !== "inactive" && (auth.admin || text(c.teacher_id) === text(auth.teacherId)));
  const allowed = new Set(activeClasses.map((c:any) => `${c.level}|${c.room}`));
  const scopedStudents = auth.admin ? activeStudents : activeStudents.filter((s:any) => allowed.has(`${s.level}|${s.room}`));
  const scopedSubjects = auth.admin ? activeSubjects : activeSubjects.filter((s:any) => activeClasses.some((c:any) => c.subject_code === s.subject_code));
  const scopedAssignments = auth.admin ? activeAssignments : activeAssignments.filter((a:any) => activeClasses.some((c:any) => c.subject_code === a.subject_code && c.level === a.level && c.room === a.room));
  const combos = [...new Map(activeClasses.map((c:any) => [`${c.subject_code}|${c.level}|${c.room}`, {subject:c.subject_code, level:c.level, room:c.room}])).values()];
  const data = { meta:{term:term?.display_label||"", requestedTerm:term?.display_label||"", generatedAt:Date.now(), termAssignmentCount:activeAssignments.length, counts:{students:scopedStudents.length, subjects:scopedSubjects.length, assignments:scopedAssignments.length}}, students:scopedStudents.map((s:any)=>uiStudent(s,term)), subjects:scopedSubjects.map((s:any)=>uiSubject(s,term)), assignments:scopedAssignments.map((a:any)=>uiAssignment(a,term)), users:users.map((u:any)=>({id:u.user_id,username:u.username,email:u.email,role:u.role,status:u.status})), combos, levels:[...new Set(scopedStudents.map((s:any)=>s.level).filter(Boolean))].sort(), rooms:[...new Set(scopedStudents.map((s:any)=>s.room).filter(Boolean))].sort(), teacherClasses:activeClasses.map((c:any)=>uiClass(c,term)), terms:terms.map((t:any)=>({TermID:t.term_id,CanonicalTermID:t.term_id,TermNo:t.term_no,AcademicYear:t.academic_year,Status:t.status,Label:t.display_label})) };
  return { success:true, term:data.meta.term, levels:data.levels, rooms:data.rooms, subjects:data.subjects, combos:data.combos, teacherClasses:data.teacherClasses, studentsLite:data.students, data };
}
async function dashboardData(auth: any, requestedTerm: any) {
  const terms = await rows("terms", "term_id,term_no,academic_year,status,display_label,legacy_term_key");
  const term=activeTermRow(terms), termId=term?.term_id;
  const [students, assignments, classes, attendance] = await Promise.all([
    rows(`students?term_id=eq.${enc(termId)}&select=student_id,level,room,term_id,status`),
    rows(`assignments?term_id=eq.${enc(termId)}&select=assignment_id,subject_code,level,room,term_id,status`),
    rows(`teacher_classes?term_id=eq.${enc(termId)}&select=teacher_class_id,term_id,teacher_id,subject_code,level,room,status`),
    termId ? api(`attendance?term_id=eq.${enc(termId)}&select=status`) : Promise.resolve([])
  ]);
  const scopedClasses=classes.filter((c:any)=>c.term_id===termId && (auth.admin || text(c.teacher_id)===text(auth.teacherId))), allowed=new Set(scopedClasses.map((c:any)=>`${c.level}|${c.room}`));
  const ss=auth.admin?students.filter((s:any)=>s.term_id===termId):students.filter((s:any)=>s.term_id===termId&&allowed.has(`${s.level}|${s.room}`));
  const aa=auth.admin?assignments.filter((a:any)=>a.term_id===termId):assignments.filter((a:any)=>a.term_id===termId&&scopedClasses.some((c:any)=>c.subject_code===a.subject_code&&c.level===a.level&&c.room===a.room));
  const ar=attendance; const status=(v:any)=>text(v).toLowerCase(); const day=ar; const count=(names:string[])=>day.filter((a:any)=>names.includes(status(a.status))).length;
  return {success:true,totalStudents:ss.length,presentToday:count(["present","มา","มาเรียน"]),totalAssignments:aa.length,riskStudents:0,stats:{present:count(["present","มา","มาเรียน"]),late:count(["late","สาย"]),leave:count(["leave","ลา"]),absent:count(["absent","ขาด"])},riskList:[],classSummary:[],termSummary:{present:0,late:0,leave:0,absent:0}};
}
const termIdFor = async (value: unknown) => {
  const raw = text(value);
  if (/^AY\d+_T\d+$/.test(raw)) return raw;
  const rows = await api(`terms?select=term_id&or=(display_label.eq.${enc(raw)},legacy_term_key.eq.${enc(raw)})&limit=1`);
  if (!rows[0]) throw new Error(`ไม่พบภาคเรียน ${raw}`);
  return rows[0].term_id;
};
async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("ไม่พบ Login Token");

  // Supabase Auth is the target identity provider. Validate its access token
  // through GoTrue first; this avoids relying on a JWT secret in the client
  // and gives us the canonical email returned by Supabase Auth.
  let email = "";
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const user = await response.json();
      email = normalizeEmail(user?.email);
    }
  } catch (_) {
    // Keep the Firebase compatibility path below during the migration window.
  }

  // Compatibility path: existing deployed builds still obtain Firebase
  // tokens. It remains enabled until the Supabase Auth build passes login,
  // role checks, and score CRUD verification.
  if (!email) {
    const verified = await jwtVerify(token, FIREBASE_JWKS, { issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID });
    email = text(verified.payload.email).toLowerCase();
  }
  if (!email) throw new Error("ไม่พบอีเมลใน Login Token");
  if (ADMIN_EMAILS.has(email)) return { admin: true, teacherId: "admin" };
  const profiles = await api(`auth_profiles?select=legacy_user_id,role,status,email&email=ilike.${enc(email)}&limit=10`);
  const profile = profiles.find((p: any) => text(p.status).toLowerCase() === "active" && text(p.role).toLowerCase() === "teacher");
  if (!profile?.legacy_user_id) throw new Error("บัญชีครูยังไม่ได้รับอนุมัติ");
  return { admin: false, teacherId: profile.legacy_user_id };
}
async function context(body: any, auth: any) {
  const termId = await termIdFor(body.term), subjectCode = text(body.subjectCode || body.subject), level = text(body.level), room = text(body.room);
  const [termRows, students, assignments, classes] = await Promise.all([
    api(`terms?term_id=eq.${enc(termId)}&select=display_label`),
    api(`students?term_id=eq.${enc(termId)}&level=eq.${enc(level)}&room=eq.${enc(room)}&select=student_id,student_no,prefix,first_name,last_name,level,room,status`),
    api(`assignments?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&level=eq.${enc(level)}&room=eq.${enc(room)}&select=assignment_id,title,assignment_type,max_score,due_date,level,room,status,subject_code`),
    api(`teacher_classes?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&level=eq.${enc(level)}&room=eq.${enc(room)}&status=neq.inactive&select=teacher_id`)
  ]);
  if (!auth.admin && !classes.some((c: any) => text(c.teacher_id) === text(auth.teacherId))) throw new Error("ครูไม่มีสิทธิ์ในวิชา ชั้น หรือห้องนี้");
  const scores = await api(`scores?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&select=score_id,assignment_id,student_id,subject_code,score,is_submitted`);
  return { termId, term:termRows[0]?.display_label || text(body.term), subjectCode, level, room, students, assignments, scores };
}
function output(ctx: any) {
  const scores: Record<string, any> = {};
  for (const row of ctx.scores) scores[`${row.assignment_id}_${row.student_id}`] = { id:row.score_id, scoreId:row.score_id, assignmentId:row.assignment_id, studentId:row.student_id, score:row.score ?? "", isSubmitted:row.is_submitted ? 1 : 0, termId:ctx.termId, term:ctx.term, subjectCode:row.subject_code };
  return { success:true, data:{ term:ctx.term, termId:ctx.termId, subject:ctx.subjectCode, subjectCode:ctx.subjectCode, level:ctx.level, room:ctx.room, students:ctx.students.map((s:any)=>({id:s.student_id,studentId:s.student_id,no:s.student_no,prefix:s.prefix||"",first:s.first_name||"",last:s.last_name||"",firstName:s.first_name||"",lastName:s.last_name||"",name:[s.prefix,s.first_name,s.last_name].filter(Boolean).join(" "),level:s.level,room:s.room,status:s.status,term:ctx.term,termId:ctx.termId})), assignments:ctx.assignments.map((a:any)=>({id:a.assignment_id,assignmentId:a.assignment_id,title:a.title||"",maxScore:Number(a.max_score||0),subjectCode:a.subject_code,type:a.assignment_type||"",dueDate:a.due_date,level:a.level,room:a.room,term:ctx.term,termId:ctx.termId})), scores } };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  try {
    const auth = await authenticate(request), body = await request.json(), action = text(body.action);
    if (action === "bootstrap") return json(await bootstrapData(auth), 200, request);
    if (action === "dashboard") return json(await dashboardData(auth, body.term), 200, request);
    if (action === "profile") {
      const requestedEmail = normalizeEmail(body.email);
      if (auth.admin && ADMIN_EMAILS.has(requestedEmail)) {
        return json({success:true, data:{id:"admin",username:requestedEmail.split("@")[0],email:requestedEmail,name:"สุรเดช ธรรมประโชติ",role:"admin",status:"Active"}}, 200, request);
      }
      const profiles = await api(`app_users?email=ilike.${enc(requestedEmail)}&select=user_id,username,email,role,status&limit=10`);
      const profile = profiles.find((row: any) => normalizeEmail(row.email) === requestedEmail && text(row.status).toLowerCase() !== "inactive");
      return json({success:!!profile, data:profile ? {id:profile.user_id,username:profile.username,email:normalizeEmail(profile.email),name:profile.username,role:profile.role,status:profile.status} : null}, 200, request);
    }
    const ctx = await context(body, auth);
    if (action === "load") return json(output(ctx), 200, request);
    if (action !== "save") throw new Error("คำสั่งไม่ถูกต้อง");
    const students = new Set(ctx.students.map((s:any)=>s.student_id)), assignments = new Set(ctx.assignments.map((a:any)=>a.assignment_id));
    const existing = new Map(ctx.scores.map((s:any)=>[`${s.assignment_id}_${s.student_id}`,s]));
    const rows = (Array.isArray(body.records) ? body.records : []).map((r:any) => {
      const assignmentId=text(r.assignmentId||r.AssignmentID), studentId=text(r.studentId||r.StudentID);
      if (!assignments.has(assignmentId)||!students.has(studentId)) throw new Error("พบรายการคะแนนนอกขอบเขตชั้นเรียน");
      const value=r.score===""||r.score==null?null:Number(r.score);
      if (value!==null&&(!Number.isFinite(value)||value<0||value>100)) throw new Error(`คะแนนของ ${studentId} ไม่ถูกต้อง`);
      const old=existing.get(`${assignmentId}_${studentId}`);
      return {score_id:old?.score_id||`SCORE_${ctx.termId}_${assignmentId}_${studentId}`,term_id:ctx.termId,assignment_id:assignmentId,student_id:studentId,subject_code:ctx.subjectCode,score:value,is_submitted:value!==null&&(r.isSubmitted===undefined||Boolean(r.isSubmitted)),updated_at:new Date().toISOString()};
    });
    if (rows.length) await api("scores?on_conflict=term_id,score_id", { method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(rows) });
    return json({ ...output(await context(body, auth)), saved:rows.length, message:"บันทึกคะแนนเข้า Supabase สำเร็จ" }, 200, request);
  } catch (error) { return json({success:false,message:error instanceof Error?error.message:String(error)},400,request); }
});
