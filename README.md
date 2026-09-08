# TikTok

Feed vertical estilo TikTok construido sobre el reproductor de YouTube, con
**contenido exclusivamente en francés** y descubrimiento automático (nada de
listas estáticas). Un solo archivo `index.html`, sin dependencias ni build:
se despliega tal cual en GitHub Pages.

---

## Despliegue en GitHub Pages

```bash
git init && git add index.html README.md
git commit -m "TikTok"
git branch -M main
git remote add origin git@github.com:<usuario>/<repo>.git
git push -u origin main
```

Luego en GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
Queda publicado en `https://<usuario>.github.io/<repo>/`.

Para probar en local (el reproductor de YouTube necesita `http://`, no `file://`):

```bash
python3 -m http.server 8080   # → http://localhost:8080
```

## Clave de API

La app pide una clave de **YouTube Data API v3** en el primer arranque y la
guarda en el `localStorage` del navegador. No hay servidor: la clave nunca sale
del navegador salvo hacia `googleapis.com`.

1. [Crea un proyecto](https://console.cloud.google.com/projectcreate) en Google Cloud.
2. Activa [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
3. [Credenciales](https://console.cloud.google.com/apis/credentials) → *Crear* → *Clave de API*.
4. **Restríngela**, porque la página es pública:
   - *Restricciones de aplicación* → **Sitios web** → `https://<usuario>.github.io/*`
   - *Restricciones de API* → solo **YouTube Data API v3**

Con eso, aunque alguien lea la clave en el `localStorage` de su propio
navegador, solo puede usarla desde tu dominio y contra esa única API.

---

## Cómo se garantiza que el contenido es francés

**YouTube no lo garantiza.** `relevanceLanguage=fr` es solo una señal de
relevancia y `snippet.defaultAudioLanguage` es un campo *opcional* que muchos
creadores no rellenan. Por eso el filtro apila cinco capas y una vídeo entra al
feed solo si el veredicto combinado supera el umbral elegido:

| Capa | Señal | Fuerza |
|---|---|---|
| **L0** | Consulta sesgada: semillas en francés + `relevanceLanguage=fr` + `regionCode=FR` | orientativa |
| **L1** | `defaultAudioLanguage` / `defaultLanguage` del vídeo | **dura** — decide sola, en positivo y en negativo |
| **L2** | Canal: `country`, `brandingSettings.defaultLanguage`, memoria local aprendida | media |
| **L3** | `LanguageDetector` del navegador (on-device, Chrome/Edge) | alta si está disponible |
| **L4** | Heurística de texto: léxico de 13 idiomas + ortografía + rechazo de escrituras no latinas | media |

Detalles que importan:

- **Rechazos duros inmediatos**: audio o metadatos declarados en otro idioma,
  escritura no latina (cirílico, árabe, CJK, devanagari…), canal ya descartado.
- **La heurística exige evidencia léxica.** Un acento aislado no basta: `è`
  solo haría pasar un título italiano por francés. El léxico francés excluye a
  propósito las palabras muy compartidas (`de`, `que`, `un`, `tu`, `il`, `ma`,
  `qui`, `y`) y cualquier palabra presente en dos idiomas se elimina de ambos.
- **Aprende por canal**: tras 3 aciertos un canal queda validado (sus vídeos
  pasan directo); tras 3 fallos queda descartado. Un simple *falta de pruebas*
  nunca condena a un canal — si no, el modo estricto acabaría eliminando
  canales franceses que rellenan mal sus metadatos.
- **Botón «Pas FR»**: el usuario descarta el canal completo de forma definitiva
  y purga sus vídeos de la cola.
- **Tres niveles de severidad** en ajustes (estricto / equilibrado / amplio).
  Al cambiarlo, los vídeos descartados por falta de pruebas vuelven a evaluarse.

Cobertura medida sobre 59 títulos reales en 16 idiomas, incluyendo casos
adversariales (francés con anglicismos, títulos de 3 palabras, catalán,
portugués frente a español): **100 %**.

## Cómo descubre contenido

**La búsqueda de YouTube quedó relegada a último recurso.** Sus resultados en
francés son mediocres, y cada `search.list` cuesta **100 unidades**. El feed
parte ahora de un **catálogo curado** de canales francófonos.

### El catálogo

[`channels.json`](channels.json) contiene canales francófonos de **más de
10 000 suscriptores**, clasificados por tema, extraídos de
[montremoitachaine.fr](https://www.montremoitachaine.fr) — un directorio de
canales francófonos ordenados por tema y por audición.

**2136 entradas, 1798 canales distintos.** Once temas, hasta **200 canales
cada uno**, los más grandes primero (niveles Titan ≥1M, Solide 100K–1M,
Ascension 10K–100K):

| Tema del directorio | `topicId` de YouTube |
|---|---|
| nourriture | Cuisine |
| animal-de-compagnie | Animaux |
| divertissement | Divertissement |
| connaissance | Connaissance |
| film | Cinéma |
| mode-de-vie | Style de vie |
| mode | Mode |
| pop | Pop |
| sante | Santé |
| societe | Société |
| tourisme | Voyage |

`animal-de-compagnie` solo tiene 136: son todos los que el directorio lista
con ≥10k. Los demás llegan al tope de 200.

La clasificación es la del directorio, no la mía, y no siempre es perfecta —
algún canal aparece bajo un tema discutible. No importa: **el filtro de idioma
sigue examinando cada vídeo**, así que un canal mal clasificado o no
francófono se descarta a nivel de vídeo. El catálogo mejora el punto de
partida; no sustituye al filtro.

El archivo guarda **solo handles públicos**, no IDs `UC`. Cada uno se resuelve
una única vez con `channels.list?forHandle=` — **1 unidad**. Extraer los IDs
del sitio habría costado ~2200 peticiones más a un sitio pequeño; resolverlos
en la app cuesta 1 unidad y solo cuando ese canal se usa de verdad.

### Lo que cuesta, medido

Meter un canal curado en el feed cuesta **3 unidades**: resolver el handle,
leer su playlist «uploads», y las metadatos de sus vídeos.

| Escenario | Coste |
|---|---|
| Una búsqueda YouTube | 100 u |
| Un canal curado nuevo | 3 u |
| 12 recargas sobre canales ya resueltos | 12 u |

Medido con un test que reproduce una selección de un solo tema: **cero
búsquedas de YouTube**, y los 5 canales servidos salieron todos de ese tema.

### Solo el catálogo

Cada canal del pool lleva su **procedencia**: `seed` si viene del catálogo,
`auto` si lo trajo la búsqueda de YouTube. Eso permite limpiar con precisión
en vez de adivinar.

*Ajustes → Annuaire francophone → Nettoyer* retira del feed **y de la hoja**
todo lo que no venga del catálogo. Se ejecuta también **una vez sola de forma
automática**, porque el pool acumulado por la búsqueda contenía canales que
nunca se pidieron. Se conservan los canales que sigues explícitamente —
quitarlos sería deshacer tu elección.

Hay que borrarlos también de la hoja, no solo del navegador: si no, la
siguiente sincronización los devuelve. La purga limpia además
`interests.chans`, donde esos canales habían acumulado peso.

Tres detalles que hicieron falta para que esto funcione de verdad:

- La purga corre **después** de fusionar el perfil remoto. La primera versión
  corría antes y marcaba su bandera igualmente: limpiaba el navegador, la hoja
  reinyectaba los mismos canales acto seguido, y la purga no volvía a pasar.
- La **fusión rechaza** los canales que no son `seed` una vez hecha la purga, y
  acaba de borrarlos de la hoja. Sin ese guardián, la hoja seguía siendo una
  puerta de entrada.
- La columna `src` se añadió a la pestaña `channels`, para que la procedencia
  sobreviva al ida y vuelta. `tab()` **repara el encabezado** si las columnas
  cambiaron: sin eso, una columna nueva desplazaría todas las escrituras.

Y el score del pool está **acotado a 8**. `hydrate` llama a `addToPool` por
cada vídeo aceptado, así que un canal muy prolífico llegaba a **438** mientras
los demás se quedaban en 1,2 — y el sorteo ponderado ya solo lo servía a él.
El tope se aplica al añadir, al fusionar desde la hoja, y una vez sobre los
valores ya guardados.

Y el ranking `mostPopular` de Francia queda **desactivado** mientras el
catálogo tenga reserva: traía canales de fuera de él.

### Variedad de canales

El `interleave` original tenía un **bug real**: repartía por índice, así que
cuando los cubos cortos se agotaban, el más largo se vaciaba **de golpe al
final**. Y como un tirón del pool trae hasta 12 vídeos de *un* canal y uno o
dos de los demás, ese caso era la norma. Medido: `A B C D A A A A A A A A A A A`
— **once vídeos consecutivos** del mismo canal.

Tres mecanismos, porque ninguno basta solo:

1. **`interleave` corregido**: sirve en cada turno el canal con más reserva,
   nunca el que acaba de sonar. Reparte un lote grande en toda su longitud.
2. **Un solo vídeo por canal y por lote**, con memoria **entre** lotes. Ni el
   mejor orden evita la serie si un lote de 8 contiene 12 vídeos de un canal:
   el sobrante espera en el búfer, no se pierde.
3. **Sorteo uniforme**: entre los candidatos permitidos, `interleave` empieza
   mezclando, así que la elección no tiene ninguna preferencia.

El hueco mínimo es de **30 posiciones**, y se **adapta** a los canales
disponibles (`min(30, alcanzables/2)`). Ese ajuste no es cosmético: con hueco
fijo de 60 y solo 80 canales, la restricción se vuelve imposible, los lotes
caen a 2 vídeos y el coste se dispara a **17 u/vídeo**. Con 30 adaptativo:
**1,06 u/vídeo**, 37 canales sobre 160 vídeos, máximo 5 pasadas por canal, y
**nunca dos seguidas**.

### Nada de puntuaciones

**Ningún canal está privilegiado.** El sorteo de canal, tanto del pool como
del catálogo, es **uniforme**. Antes ponderaba por puntuación acumulada,
antigüedad del último tirón, condición de favorito y «me gusta» — y un canal
que llegaba a 438 mientras los demás estaban en 1,2 monopolizaba el feed. El
nivel de audiencia tampoco cuenta: un canal de 12 000 suscriptores tiene
exactamente las mismas probabilidades que uno de diez millones.

El campo `score` sigue en la hoja a título informativo, pero **no interviene en
ninguna selección**.

También probé un reparto rotatorio (primero el canal menos servido) y lo
**retiré**: medido sobre 187 vídeos no cambiaba nada — 37 canales, máximo 6
pasadas, mismo coste — y acortaba el hueco real de 30 a 14 posiciones. La
variedad la da el hueco impuesto, no una lotería trucada.

Lo único que sigue ponderado es la elección de **qué fuente** consultar
(`seed`, `pool`, `search`…), que es una decisión de coste, no de contenido.

Además, una selección explícita de temas ahora **restringe** el pool, no solo
lo pondera — si no, los canales descubiertos bajo los temas anteriores seguían
alimentando el feed después de cambiarlos.

### La jerarquía de fuentes

1. **`seed`** — un canal del catálogo que coincide con tus temas (3 u).
2. **`pool`** — la playlist «uploads» de un canal ya resuelto (1 u / 50 vídeos).
   Los canales cuyo tema del directorio coincide con tu selección pesan 2,5×.
3. **`favs`** — los canales que sigues.
4. **`chart`** — el ranking `mostPopular` de Francia (1 u). **Desactivado**
   mientras queden canales curados: sus canales no están en el catálogo.
5. **`search`** — **desactivada** mientras queden 15+ canales curados sin
   resolver. Solo entra cuando el catálogo se agota.

Encima sigue el modelo de intereses ε-greedy, pero como apoyo: tus temas y
palabras clave pasan siempre delante.

### Regenerar el catálogo

El directorio muestra solo 24 canales por nivel, «renouvelée à chaque visite»,
así que el extractor visita cada página repetidas veces y acumula hasta cubrir
los niveles o dejar de encontrar novedades. Respeta `robots.txt` (que prohíbe
`/api/`, de donde tira la página `/classement`) y espacia las peticiones 1,1 s.
Los scripts están en el historial de esta conversación; el resultado es un
archivo estático que no hace falta regenerar salvo que quieras refrescarlo.

## Canales favoritos

**Suivre** en cualquier vídeo añade el canal. Entonces:

- La pestaña **Abonnements** es un feed vertical con sus vídeos nuevos, del más
  reciente al más antiguo, **sin filtro de idioma ni de duración** — son los
  canales que tú elegiste.
- El badge del contador de novedades se calcula con `videoPublishedAt` de
  `playlistItems`: 1 unidad por canal, sin necesidad de `videos.list`.
- El panel **Mes chaînes** lista los canales con su contador y permite escanear
  a demanda o dejar de seguirlos.
- Seguir un canal lo marca como francés validado y lo prioriza en el pool.

## Iconos

Al añadir la página a la pantalla de inicio se comporta como una app: sin
barras de Safari (`display: standalone`), orientación vertical, e icono propio.

Todos los tamaños se derivan de un único origen, `icons/icon-source.png`
(copia intacta del icono de 180×180). Para regenerarlos tras cambiarlo:

```bash
S=icons/icon-source.png
BG=$(magick "$S" -format "%[pixel:p{14,90}]" info:)      # fondo real del icono

for SZ in 16 32 48; do                                    # favicons, con alfa
  magick "$S" -filter Lanczos -resize ${SZ}x${SZ} -strip icons/favicon-${SZ}.png
done
magick icons/favicon-16.png icons/favicon-32.png icons/favicon-48.png icons/favicon.ico

for SZ in 192 512 1024; do                                # manifest, opacos
  magick "$S" -filter Lanczos -resize ${SZ}x${SZ} -unsharp 0x0.8+0.5+0.02 \
          -background "$BG" -alpha remove -alpha off -depth 8 -strip icons/icon-${SZ}.png
done

magick "$S" -filter Lanczos -resize 400x400 -unsharp 0x0.8+0.5+0.02 \
        -background "$BG" -alpha remove -gravity center -extent 512x512 \
        -alpha off -depth 8 -strip icons/icon-maskable-512.png

magick "$S" -background "$BG" -alpha remove -alpha off -depth 8 -strip icons/apple-touch-icon.png
```

| Archivo | Uso |
|---|---|
| `icon-source.png` | origen intacto, no se sirve |
| `favicon.ico` (16/32/48) | pestañas, marcadores, navegadores antiguos |
| `favicon-16/32/48.png` | pestañas modernas |
| `apple-touch-icon.png` | pantalla de inicio iOS, 180×180 opaco |
| `icon-192/512/1024.png` | manifest, `purpose: any` |
| `icon-maskable-512.png` | manifest, `purpose: maskable` |
| `icon.svg` | diseño original, conservado sin usar |

Cuatro detalles que importan y que no son evidentes:

- **Nada de favicon SVG.** Chrome y Firefox lo prefieren a los PNG cuando se
  declaran ambos, así que un `icon.svg` declarado sobrescribiría el favicon
  por mucho que pongas los PNG debajo. Por eso ya no se declara.
- Safari **ignora el SVG** para `apple-touch-icon`: exige un PNG de 180×180,
  y compone mal el canal alfa — de ahí el aplanado sobre el fondo del icono.
- La variante **maskable** existe porque Android recorta un círculo del 80 %
  del lado. El glifo se reduce al 78 % para caber en la zona segura; sin eso,
  se le comerían los bordes.
- `black-translucent` hace que el contenido pase por debajo de la barra de
  estado — de ahí los márgenes `env(safe-area-inset-*)` del CSS.

---

## Perfil en una Google Sheet (Apps Script)

La clave API sigue en `localStorage`. El **perfil** — canales descubiertos,
suscripciones, temas, intereses, «me gusta» — vive en una hoja de cálculo, así
que sobrevive al borrado del navegador y sigue a todos tus dispositivos.

La hoja es **pública** por decisión deliberada: el perfil lo puede leer
cualquiera con el enlace. Eso simplifica todo — el ID de la hoja no es un
secreto y va escrito directamente en `Code.gs`.

### Puesta en marcha

1. [script.google.com](https://script.google.com) → Nuevo proyecto → pega
   [apps-script/Code.gs](apps-script/Code.gs).
2. Pon el ID de tu hoja en `SHEET_ID` (está en su URL:
   `/spreadsheets/d/<ID>/edit`).
3. Ejecuta `setup()` una vez: concede los permisos y crea las pestañas.
4. Implementar → Nueva implementación → **Aplicación web**, ejecutar *como yo*,
   acceso *cualquier persona*. Copia la URL `.../exec`.
5. Pega esa URL en la app — en la pantalla de inicio, o en Ajustes →
   Sincronización → **Connecter**. Ahí queda un enlace directo a la hoja.

> **Al modificar `Code.gs` hay que volver a desplegar.** La URL `/exec` apunta a
> una **versión congelada** del script: guardar en el editor no cambia nada de
> lo que sirve esa URL. Hay que hacer *Implementar → Gestionar implementaciones
> → ✏️ → Versión: **Nueva versión** → Implementar*. La URL no cambia. Es el
> error más fácil de cometer y el más difícil de diagnosticar.

### Sin autenticación

No hay token: Google no lo pide, y siendo la hoja pública no protegería nada
que no esté ya a la vista. Lo único que sí quité del alcance de la URL `/exec`
es la operación destructiva: `resetProfile()` **no está expuesta por HTTP** y
solo se ejecuta desde el editor de Apps Script.

Una única precaución, y es funcional más que de privacidad: que sea pública
**en lectura**. Si la dejas editable por cualquiera, un desconocido podría
corromper el perfil.

### Arquitectura: local-first

Un feed vertical no puede esperar 500 ms de ida y vuelta a cada «me gusta». Así
que `localStorage` sigue siendo la caché de trabajo: al arrancar se **tira** del
estado remoto y se fusiona, después se **empujan deltas** con 6 s de retardo.

Las fusiones son **uniones conmutativas** — el orden entre dispositivos no
importa — con dos excepciones deliberadas: un veredicto «no es francés» es
definitivo y gana siempre, y los ajustes vienen del remoto, que es la
referencia.

El envío es **automático**, nunca hace falta pulsar nada. Tres detalles que lo
hacen fiable:

- **Debounce acotado** (6 s, máximo 45 s). Un debounce simple se moría de
  hambre: cada slide llama a `markSeen()` y `reinforce()`, así que al hacer
  scroll continuo el temporizador se rearmaba cada 2 s y el envío no llegaba
  nunca. `MAX_WAIT` garantiza una latencia máxima.
- **Reintento a los 30 s** si falla la red. Antes un fallo esperaba a la
  siguiente modificación.
- **`navigator.sendBeacon` al salir de la página**, porque iOS puede matar un
  `fetch` al congelar la pestaña. Las escrituras son upserts idempotentes, así
  que un duplicado eventual no hace daño.

### La trampa del CORS

**Apps Script no responde a las peticiones previas de CORS (`OPTIONS`).** Por
eso el cliente envía `Content-Type: text/plain;charset=utf-8`: así la petición
sigue siendo una *simple request* y el navegador nunca lanza el preflight.
Cambiarlo a `application/json` rompería todo, y no se puede arreglar añadiendo
cabeceras en `doPost` — el preflight falla antes de que tu código se ejecute.

### Pestañas de la hoja

| Pestaña | Contenido |
|---|---|
| `kv` | ajustes, intereses, estadísticas, memoria de idioma, vistos (JSON) |
| `channels` | el pool de canales descubiertos, con su puntuación |
| `subscriptions` | tus canales seguidos |
| `topics` | categorías, temas y palabras clave elegidas |
| `liked` | tus «me gusta» |

Una celda de Sheets admite 50 000 caracteres, así que los valores grandes se
parten en trozos (`seen#0`, `seen#1`…) y se reensamblan al leer. Y las
escrituras se hacen en **un solo `setValues()`** por pestaña: celda a celda,
300 canales tardarían minutos y agotarían las cuotas de Apps Script.

La clave API de YouTube nunca se envía a la hoja — se queda en el
`localStorage` del navegador.

---

## Temas de interés configurables

Panel *Ajustes → Centros de interés*. Tres ejes, y conviene saber cuál sirve
para qué:

- **Palabras clave** (`q`): el levier más eficaz. «recette de grand-mère» da
  mejores resultados que una categoría entera.
- **Categorías** (`videoCategoryId`): las ~15 oficiales, con etiquetas en
  francés que la propia API entrega para la región FR. Exige `type=video`.
- **Temas** (`topicId`): un juego **congelado** de identificadores desde el
  final de Freebase (27-02-2017). Es toda la granularidad que existe.

El interruptor *N'utiliser que mes thèmes* decide si la selección **restringe**
la búsqueda o solo la **prioriza** dejando que la exploración siga.

Ojo con una trampa de la API: `topicDetails.topicIds` y `relevantTopicIds`
están deprecados desde el 10-11-2016 y **devuelven vacío**. Solo
`topicCategories` (URLs de Wikipedia) sigue dando datos, y no es consultable.

### Lo que la API *no* hace

**La API de YouTube no aprende tus gustos.** Con una API key las llamadas son
apátridas y anónimas: la clave identifica al proyecto, no a una persona. Y con
OAuth tampoco hay recomendaciones — `activities.list?home=true` está deprecado,
y el historial de visualización se retiró en 2016. Por eso el modelo de
intereses es nuestro, y por eso guardarlo importa.

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `↓` `j` / `↑` `k` | siguiente / anterior |
| `espacio` | pausa |
| `m` | sonido |
| `l` | me gusta |
| `Esc` | cerrar paneles |

Gestos: swipe vertical, un toque para pausar, doble toque para «me gusta».

La interfaz replica la de TikTok:

- **Arriba, centrado**: las pestañas `Abonnements | Pour toi`, con el
  subrayado en la activa y el contador de novedades en Abonnements.
- **Abajo**: los cinco elementos de TikTok — Accueil, Amis, el botón `+` con
  sus filos cian y rojo, Messages, Profil.
- **A la derecha**: avatar del canal con su botón de seguir encima, y las
  acciones con iconos rellenos de 34 px.

*Amis*, `+` y *Messages* no tienen equivalente aquí. Se conserva la referencia
visual, pero al pulsarlos lo dicen claramente en vez de fingir una pantalla
vacía. Todo lo que sí existe vive en **Profil**: Centres d'intérêt, Mes
chaînes y Réglages, con las estadísticas del filtro y el consumo de cuota.

## Límites conocidos

- El navegador solo permite autoplay **silenciado**; hay que tocar una vez
  «Appuie pour le son» (igual que TikTok o Instagram en web). La reproducción
  arranca **siempre** en silencio y el sonido se aplica *después* de confirmar
  que la vídeo rueda: pedir reproducción no silenciada la bloquea, porque tu
  toque ocurre en la página y no dentro del iframe de YouTube, que no recibe
  esa activación. Si el navegador aun así la pausa, la app vuelve a silencio y
  lo dice, en vez de dejar una pantalla congelada.
- Esa red de seguridad distingue las pausas **que la app provoca** (cambio de
  slide, toque para pausar, precarga) de las que impone el navegador. Sin esa
  distinción se disparaba en falso: `setActive` pausa el vídeo anterior
  **antes** de actualizar el índice activo, así que su evento `PAUSED` parecía
  venir del vídeo en pantalla — y hacer un swipe dentro del segundo y medio
  desactivaba el sonido de forma permanente.
- El desenfoque de fondo (`backdrop-filter`) se aplica **solo a la slide
  visible**. Aplicado a todas, el compositor mezclaba dos capas desenfocadas
  por slide durante el scroll, y ahí se perdía la fluidez. El degradado, que
  es lo que tapa la incrustación de YouTube, sí va en todas: cuesta cero.
- El short siguiente se **precarga** vía `autoplay=1`, no con una llamada a
  `playVideo()`: el reproductor llena su búfer en cuanto su iframe está lista,
  sin depender de cuándo YouTube avisa de «ready». Se congela en su primer
  fotograma y el swipe reanuda desde ahí. Medido con un reproductor simulado
  (init 600 ms, arranque en frío 1200 ms): **60 ms** por swipe en vez de 1200.
  Cuesta un vídeo de adelanto en datos.
- Mientras carga se muestra la **miniatura real a pantalla completa**. Es lo
  que elimina la sensación de espera: un fondo negro de un segundo se nota, el
  primer fotograma de la vídeo no. Solo se decodifica en las slides cercanas
  a la visible — decodificar cincuenta imágenes a pantalla completa entrecorta
  el scroll.
- Cambiar de tema o añadir palabras clave **descarta la cola** y fuerza una
  búsqueda nueva al cerrar el panel: sin eso el pool, poblado con los temas
  anteriores, seguía sirviendo lo viejo durante decenas de vídeos. Cuesta 100
  unidades por cambio.
- Los vídeos con el embed desactivado por su autor no se pueden reproducir; se
  detectan por `status.embeddable` y por el error del reproductor, y se saltan.
- `LanguageDetector` solo existe hoy en Chrome/Edge; sin él el filtro cae a la
  heurística de texto, que es la capa más débil.
- La cuota se reinicia a medianoche del Pacífico (≈ 9 h en Francia).
- Todo el estado (clave, favoritos, intereses, memoria de idioma) es local por
  navegador: no se sincroniza entre dispositivos.
