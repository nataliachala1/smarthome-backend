param(
  [string]$PostgresImage = 'postgres:16-alpine',
  [string]$DatabaseRepository = (Join-Path $PSScriptRoot '../smarthome-database')
)

$ErrorActionPreference = 'Stop'
$fixturePath = (Resolve-Path -LiteralPath (Join-Path $DatabaseRepository 'scripts/session-security-fixture.sql')).Path
$backendPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$testContainer = 'smarthome-session-test-' + [guid]::NewGuid().ToString('N')
$started = $false
$previousTestUrl = $env:SESSION_TEST_DATABASE_URL
$syntheticPassword = [guid]::NewGuid().ToString('N')

try {
  # Only a new, disposable server; random port published on loopback, no host volumes.
  & docker run --detach --rm --name $testContainer --publish '127.0.0.1::5432' `
    --env POSTGRES_USER=session_test --env POSTGRES_DB=smarthome_session_test `
    --env "POSTGRES_PASSWORD=$syntheticPassword" `
    --tmpfs /var/lib/postgresql/data:rw,size=268435456 `
    --mount "type=bind,source=$fixturePath,target=/fixture.sql,readonly" $PostgresImage `
    postgres -c 'default_transaction_isolation=repeatable read' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create disposable session-test server' }
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $testContainer pg_isready -h 127.0.0.1 -U session_test -d smarthome_session_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready' }
  & docker exec $testContainer psql -X -U session_test -d smarthome_session_test --set=ON_ERROR_STOP=1 --file=/fixture.sql
  if ($LASTEXITCODE -ne 0) { throw 'Unable to load synthetic session fixture' }
  $publishedPort = (& docker port $testContainer 5432/tcp | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $publishedPort -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Expected a loopback-only test port' }
  $env:SESSION_TEST_DATABASE_URL = "postgresql://session_test:$syntheticPassword@127.0.0.1:$($Matches[1])/smarthome_session_test"
  Push-Location -LiteralPath $backendPath
  try {
    & npm.cmd run test:e2e -- --runInBand --runTestsByPath test/session-security-postgres.e2e-spec.ts test/session-flow-postgres.e2e-spec.ts
    if ($LASTEXITCODE -ne 0) { throw 'Session security PostgreSQL tests failed' }
  } finally { Pop-Location }
} finally {
  $env:SESSION_TEST_DATABASE_URL = $previousTestUrl
  if ($started) { & docker rm --force $testContainer | Out-Null }
}
