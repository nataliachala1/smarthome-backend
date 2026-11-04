param(
  [string]$DatabaseRepository = (Join-Path $PSScriptRoot '../smarthome-database'),
  [switch]$MigrationOnly
)
$ErrorActionPreference = 'Stop'
$databasePath = (Resolve-Path -LiteralPath $DatabaseRepository).Path
$backendPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$testId = [guid]::NewGuid().ToString('N')
$testContainer = 'smarthome-consumption-' + $testId
$testNetwork = 'smarthome-consumption-net-' + $testId
$syntheticPassword = [guid]::NewGuid().ToString('N')
$started = $false
$networkCreated = $false
$previousTestUrl = $env:CONSUMPTION_TEST_DATABASE_URL

function Invoke-TestLiquibase {
  param([string[]]$CommandArguments)
  & docker run --rm --network $testNetwork --mount "type=bind,source=$databasePath,target=/liquibase/project,readonly" `
    --workdir /liquibase/project liquibase/liquibase:4.29 `
    --defaults-file=/dev/null --changelog-file=changelog/changelog-master.yaml `
    "--url=jdbc:postgresql://${testContainer}:5432/smarthome_consumption_test" `
    --username=consumption_owner "--password=$syntheticPassword" @CommandArguments
  if ($LASTEXITCODE -ne 0) { throw 'Liquibase failed against the disposable test database' }
}

function Get-TestDataFingerprint {
  $query = "SELECT md5((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id_consumption,read_at)::text,'[]') FROM consumption.consumption c) || (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id_refresh_token)::text,'[]') FROM auth.refresh_token r))"
  $fingerprint = (& docker exec $testContainer psql -X -qAt -U consumption_owner -d smarthome_consumption_test --set=ON_ERROR_STOP=1 --command=$query | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $fingerprint -notmatch '^[a-f0-9]{32}$') { throw 'Unable to fingerprint synthetic data' }
  return $fingerprint
}

try {
  & docker network create $testNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create isolated test network' }
  $networkCreated = $true
  & docker run --detach --rm --name $testContainer --network $testNetwork --publish '127.0.0.1::5432' `
    --env POSTGRES_USER=consumption_owner --env POSTGRES_DB=smarthome_consumption_test `
    --env "POSTGRES_PASSWORD=$syntheticPassword" --tmpfs /var/lib/postgresql/data:rw,size=268435456 `
    --mount "type=bind,source=$databasePath,target=/test-database,readonly" postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create disposable consumption test server' }
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $testContainer pg_isready -h 127.0.0.1 -U consumption_owner -d smarthome_consumption_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable database did not become ready' }
  Invoke-TestLiquibase -CommandArguments @('update', '--label-filter=!HU16')
  Invoke-TestLiquibase -CommandArguments @('update')
  if (-not $MigrationOnly) {
    & docker exec $testContainer psql -X -U consumption_owner -d smarthome_consumption_test --set=ON_ERROR_STOP=1 `
      "--set=app_password=$syntheticPassword" --file=/test-database/scripts/consumption-access-fixture.sql
    if ($LASTEXITCODE -ne 0) { throw 'Unable to load consumption fixtures' }
    $publishedPort = (& docker port $testContainer 5432/tcp | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $publishedPort -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Expected loopback-only test port' }
    $env:CONSUMPTION_TEST_DATABASE_URL = "postgresql://consumption_app_test:$syntheticPassword@127.0.0.1:$($Matches[1])/smarthome_consumption_test"
    Push-Location -LiteralPath $backendPath
    try {
      & npm.cmd run test:e2e -- --runInBand --runTestsByPath test/consumption-access-postgres.e2e-spec.ts
      if ($LASTEXITCODE -ne 0) { throw 'Consumption/RLS tests failed' }
    } finally { Pop-Location }
    $dataBefore = Get-TestDataFingerprint
    # Exercise the compatible-preexisting schema path with persisted synthetic rows.
    & docker exec $testContainer psql -X -U consumption_owner -d smarthome_consumption_test --set=ON_ERROR_STOP=1 `
      --file=/test-database/releases/009_session_schema/001_session_schema.sql
    if ($LASTEXITCODE -ne 0) { throw 'Session bridge rejected its compatible preexisting schema' }
    if ($dataBefore -ne (Get-TestDataFingerprint)) { throw 'Session bridge changed synthetic business/session data' }
  }
  Invoke-TestLiquibase -CommandArguments @('rollback-count', '--count=1')
  Invoke-TestLiquibase -CommandArguments @('update')
  if (-not $MigrationOnly -and $dataBefore -ne (Get-TestDataFingerprint)) { throw 'Rollback/reapply changed synthetic data' }
  Write-Output 'PASS: baseline update, incremental update, rollback-count=1 and reapply on disposable PostgreSQL.'
} finally {
  $env:CONSUMPTION_TEST_DATABASE_URL = $previousTestUrl
  if ($started) { & docker rm --force $testContainer | Out-Null }
  if ($networkCreated) { & docker network rm $testNetwork | Out-Null }
}
