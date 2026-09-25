param(
  [string]$ProjectId = 'classroom-attendance-2569'
)

$ErrorActionPreference = 'Stop'

function Get-FirebaseNode([string]$Path) {
  $raw = firebase database:get $Path --project $ProjectId 2>$null
  if (-not $raw) { return @{} }
  return (($raw -join "`n") | ConvertFrom-Json)
}

function Get-Rows($Node) {
  if ($null -eq $Node) { return @() }
  return @($Node.PSObject.Properties | ForEach-Object { $_.Value })
}

Write-Host "Read-only canonical ID audit: $ProjectId"
$terms = Get-FirebaseNode '/terms'
$teacherClasses = Get-FirebaseNode '/teacherClasses'
$students = Get-FirebaseNode '/students'
$assignments = Get-FirebaseNode '/assignments'
$attendance = Get-FirebaseNode '/attendance'
$scores = Get-FirebaseNode '/scores'

$sets = @(
  @{ Name = 'terms'; Rows = Get-Rows $terms; Required = @('TermID') },
  @{ Name = 'teacherClasses'; Rows = Get-Rows $teacherClasses; Required = @('TeacherClassID', 'TeacherID', 'TermID') },
  @{ Name = 'students'; Rows = Get-Rows $students; Required = @('StudentID') },
  @{ Name = 'assignments'; Rows = Get-Rows $assignments; Required = @('AssignmentID') },
  @{ Name = 'attendance'; Rows = Get-Rows $attendance; Required = @('RecordID') },
  @{ Name = 'scores'; Rows = Get-Rows $scores; Required = @('ScoreID') }
)

foreach ($set in $sets) {
  $rows = @($set.Rows)
  $missing = @($rows | Where-Object {
    $row = $_
    @($set.Required | Where-Object { [string]::IsNullOrWhiteSpace([string]$row.$_) }).Count -gt 0
  }).Count
  $classIds = @($rows | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.ClassID) }).Count
  $termIds = @($rows | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.TermID) }).Count
  Write-Host ("{0,-15} rows={1,5} missingPrimary={2,5} ClassID={3,5} TermID={4,5}" -f $set.Name, $rows.Count, $missing, $classIds, $termIds)
}

Write-Host 'No Firebase write was performed.'
