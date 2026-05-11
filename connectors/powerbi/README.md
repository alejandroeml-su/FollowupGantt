# Sync Power BI Custom Data Connector

Wave P21-C entrega el **source M** del connector (`SyncConnector.pq`).
Compilarlo a `.mez` requiere herramienta Microsoft (no se hace en CI):

## Pre-requisitos

- Windows 10/11 con **Visual Studio 2019/2022** (Community basta).
- Extensión **Power Query SDK for Visual Studio** (descargar del Marketplace).
- **Power BI Desktop** instalado (para probar el `.mez` resultante).

## Build paso a paso

1. Abrir Visual Studio → **File → New → Project**.
2. Plantilla **"Data Connector Project"** (categoría Power Query).
3. Reemplazar el archivo `*.pq` autogenerado por `SyncConnector.pq` de este folder.
4. (Opcional) Agregar PNGs de íconos `Sync16.png … Sync40.png` al proyecto y marcarlos como **Embedded Resource**.
5. **Build → Build Solution** → genera `SyncConnector.mez` en `bin/Debug/`.

## Distribución a usuarios finales

```text
copy bin\Debug\SyncConnector.mez %USERPROFILE%\Documents\Power BI Desktop\Custom Connectors\
```

Luego en cada PC con Power BI Desktop:

1. **File → Options and settings → Options → Security**.
2. Sección **Data Extensions** → marcar **"(Not Recommended) Allow any extension to load without validation or warning"** *o* configurar trust por firma digital (recomendado para empresa).
3. Reiniciar Power BI Desktop.
4. **Get Data → search "Sync"** → el connector aparece bajo **Online Services**.

## Firma digital (recomendado producción)

Para evitar el warning "Not Recommended", firmar el `.mez` con un certificado de la organización:

```powershell
signtool sign /f certificate.pfx /p <password> /tr http://timestamp.digicert.com /td sha256 /fd sha256 SyncConnector.mez
```

Una vez firmado, distribuir el certificado al trust store de cada equipo (típico vía GPO en Active Directory).

## Notas técnicas

- El `.pq` usa `OData.Feed` con `Implementation = "2.0"` y `ODataVersion = 4` — esto activa el **query folding** real (Power BI traduce filtros M a `$filter` OData).
- Auth tipo `Key` → Power BI inyecta `Authorization: Bearer <key>` automáticamente.
- `TestConnection` está minimal — basta con resolver el service document para validar que la API key es válida.
- Sin íconos PNG el connector se renderiza con el icono genérico de Power Query — funcional pero menos polido. Agregar PNGs en una iteración futura.

## Alternativa sin connector compilado

Mientras el `.mez` no esté distribuido, los usuarios pueden conectarse con **OData Feed nativo** apuntando directamente a la URL — ver `docs/integrations/powerbi.md` sección "Opción A".
