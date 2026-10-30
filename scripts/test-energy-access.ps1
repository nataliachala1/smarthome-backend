# SQL034 - Pruebas de integracion de energia con PostgreSQL real y RLS activa.
#
# Crea un PostgreSQL 16 DESECHABLE en Docker (sin volumen, en memoria), aplica
# TODAS las migraciones Liquibase de smarthome-database (incluida SQL034), carga
# la fixture oficial scripts/consumption-access-fixture.sql y ejecuta
# test/energy-access-postgres.e2e-spec.ts con el LOGIN no privilegiado
# consumption_app_test. Al terminar elimina el contenedor y la red.
#
# Nunca usa la base local de desarrollo ni la del VPS.
#
# Uso (desde la carpeta smarthome-backend, con Docker Desktop abierto):
#   powershell -ExecutionPolicy Bypass -File scripts/test-energy-access.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/test-energy-access.ps1 -DatabaseRepository C:\ruta\smarthome-database
param(
  [string]$DatabaseRepository = (Join-Path $PSScriptRoot '../../smarthome-database')
)
$ErrorActionPreference = 'Stop'
$databasePath = (Resolve-Path -LiteralPath $DatabaseRepository).Path
$backendPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$testId = [guid]::NewGuid().ToString('N')
$testContainer = 'smarthome-energy-' + $testId
$testNetwork = 'smarthome-energy-net-' + $testId
$syntheticPassword = [guid]::NewGuid().ToString('N')
$started = $false
$networkCreated = $false
$previousTestUrl = $env:ENERGY_TEST_DATABASE_URL

if (-not (Test-Path -LiteralPath (Join-Path $databasePath 'releases/034_energy_tariff_budget/changelog.yaml'))) {
  throw "El repositorio de base de datos en '$databasePath' no contiene SQL034 (rama dev de smarthome-database)."
}

function Invoke-TestLiquibase {
  param([string[]]$CommandArguments)
  & docker run --rm --network $testNetwork --mount "type=bind,source=$databasePath,target=/liquibase/project,readonly" `
    --workdir /liquibase/project liquibase/liquibase:4.29 `
    --defaults-file=/dev/null --changelog-file=changelog/changelog-master.yaml `
    "--url=jdbc:postgresql://${testContainer}:5432/smarthome_consumption_test" `
    --username=consumption_owner "--password=$syntheticPassword" @CommandArguments
  if ($LASTEXITCODE -ne 0) { throw 'Liquibase fallo contra la base desechable de pruebas' }
}

try {
  & docker network create $testNetwork | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la red aislada de pruebas' }
  $networkCreated = $true
  & docker run --detach --rm --name $testContainer --network $testNetwork --publish '127.0.0.1::5432' `
    --env POSTGRES_USER=consumption_owner --env POSTGRES_DB=smarthome_consumption_test `
    --env "POSTGRES_PASSWORD=$syntheticPassword" --tmpfs /var/lib/postgresql/data:rw,size=268435456 `
    --mount "type=bind,source=$databasePath,target=/test-database,readonly" postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el PostgreSQL desechable' }
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $testContainer pg_isready -h 127.0.0.1 -U consumption_owner -d smarthome_consumption_test *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'La base desechable no estuvo lista a tiempo' }

  Invoke-TestLiquibase -CommandArguments @('update')

  & docker exec $testContainer psql -X -U consumption_owner -d smarthome_consumption_test --set=ON_ERROR_STOP=1 `
    "--set=app_password=$syntheticPassword" --file=/test-database/scripts/consumption-access-fixture.sql
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo cargar la fixture de pruebas' }

  $publishedPort = (& docker port $testContainer 5432/tcp | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $publishedPort -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Se esperaba un puerto solo en loopback' }
  $env:ENERGY_TEST_DATABASE_URL = "postgresql://consumption_app_test:$syntheticPassword@127.0.0.1:$($Matches[1])/smarthome_consumption_test"

  Push-Location -LiteralPath $backendPath
  try {
    & npm.cmd run test:e2e -- --runInBand --runTestsByPath test/energy-access-postgres.e2e-spec.ts
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de energia con RLS' }
  } finally { Pop-Location }

  Write-Output 'PASS: SQL034 energia con PostgreSQL real, RLS activa y LOGIN no privilegiado.'
} finally {
  $env:ENERGY_TEST_DATABASE_URL = $previousTestUrl
  if ($started) { & docker rm --force $testContainer | Out-Null }
  if ($networkCreated) { & docker network rm $testNetwork | Out-Null }
}
