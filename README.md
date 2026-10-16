# Bomba Lab

Simulador web interactivo de una bomba centrífuga. Permite:
- Ver y modificar el diseño del rodete.
- Ubicar el punto de funcionamiento contra la curva del sistema y regularlo con la válvula, la velocidad o el recorte del rodete.
- Seguir la ANPA (NPSH) y ver cuándo cavita.
- Combinar dos bombas en serie o en paralelo.
- Explorar la semejanza (ns y leyes de afinidad).
- Verlo todo como **plano técnico**: isométrico de cañerías con tags, P&ID con símbolos ISA y cortes A-A y B-B de la bomba con rayado y cajetín.

Todo con un rodete y una voluta en 3D por donde circula el flujo. Sigue la notación de los apuntes de Turbomáquinas de la cátedra: el 13 (*Bombas dinámicas*) y el 08 (*Análisis dimensional*). Es el proyecto hermano de [Turbofan Lab](https://github.com/jotabulacios/turbofan_lab).

**En vivo:** https://jotabulacios.github.io/bomba_lab/

## Cómo correrlo

Requisitos: Python 3 para servir los archivos y Node ≥ 20 para los tests. No hay dependencias que instalar, porque Three.js se carga desde jsdelivr.

```bash
make serve      # http://localhost:8000
make test       # tests del modelo físico (node --test)
```

## Uso

| Dónde | Qué hace |
|---|---|
| Panel izquierdo | Preset (*Didáctica*; *Ruhrpumpen*, ajustado a la hoja de ensayo del apunte; *Grundfos CM5-2*, ajustado al ensayo del TP 4; o un ensayo propio cargado por CSV), operación (n, recorte de D2), diseño del rodete (β2, z, D2, b2, D1, Q de diseño, ηh, resbalamiento), fluido (temperatura del agua, altitud), instalación (H_geo, pérdidas, válvula, altura de aspiración Hs) y conexión (una bomba, serie o paralelo). |
| Barra superior | Punto de funcionamiento: Q, H, ηT, P eje, ANPAd, ANPAr, τ de Thoma, ns y estado de la ANPA (sin cavitación, margen bajo o cavita). |
| Pestaña **Curvas** | H–Q con la curva del sistema y el punto de funcionamiento; ηT–Q con el BEP; P–Q; ANPAd y ANPAr contra Q con la zona de cavitación. Comparten el eje Q y un cursor común, y tienen vista de tabla. Con los presets *Ruhrpumpen* y *CM5-2 (TP 4)* o con un ensayo propio se superponen los **puntos del ensayo** (□), llevados con las leyes de afinidad a la n y el D2 actuales, y una tarjeta **Hoja de ensayo** compara H, η y P medidos contra el modelo y verifica el punto garantizado con la tolerancia HI 2016 grado 2B (cuando la hoja la trae). Si el ensayo midió potencia **eléctrica**, se comparan P y η del conjunto motor-bomba. Al final, **Cargar un ensayo propio (CSV)**: acepta el formato procesado (Q, H, P, η) o la planilla de la guía del TP (Q, Ps, Pe, V, I, cos φ), ajusta el modelo y lo deja como preset; queda guardado en el navegador. |
| Pestaña **Rodete** | Triángulos de entrada y salida (c, w, u; c2 con y sin resbalamiento), incidencia, rodete en planta, efecto de β2 sobre H_t∞ y el grado de reacción, y los rendimientos ηh, ηv y ηm. |
| Pestaña y vista **Diseño** | La bomba sola **a escala real**: rodete y voluta (la garganta se dimensiona con Q_d), con la referencia como fantasma translúcido y las cotas D1, D2, b2, β2 y z. Al pasar el mouse por un parámetro de diseño se resalta su cota. La pestaña muestra la sección meridional, las curvas H–Q y η–Q actual contra referencia, una tabla de cambios (H a caudal cero, BEP, P, ANPAr, ns, σ, D2/D1) y notas que explican cada cambio. Botones para fijar la referencia y para volver a ella. |
| Pestaña **Esquema** | P&ID de la instalación con símbolos ISA 5.1: tanques con nivel, bomba(s) centrífuga(s), válvula de compuerta V-01, retenciones CV-A/B en paralelo, manómetros PI con su lectura. Cada línea lleva su número, DN y velocidad. Se redibuja para una bomba, serie o paralelo, con el estado de cada bomba (en marcha, sin aporte o cavitando). Debajo, la lista de líneas. Se descarga como SVG o PNG. |
| Pestaña **Semejanza** | ns, nq y Ns; Φ y Ψ; tabla de tipos de rodete (apunte 13, p. 17); comparación entre las leyes de afinidad y el modelo al cambiar n o recortar D2. |
| Visor 3D, **Instalación** (por defecto) | Tanque de aspiración (la bomba en carga o aspirando según Hs, con su cota), bomba sobre su base, cañería con válvula de volante y tanque elevado a H_geo (escala vertical comprimida). Funciona con una bomba, dos en serie o dos en paralelo con colectores (selector **Una bomba · Serie · Paralelo** arriba a la izquierda, o en el panel, *Conexión*); si una bomba no aporta, se ve apagada. Las partículas avanzan con el caudal de cada rama y se colorean por presión manométrica (vacío ↔ presión). Hay manómetros en vivo, y la bomba que cavita se pone en rojo. Clic en una bomba para verla por dentro. |
| Estilo **3D / Plano** (barra superior, `B`) | En Plano, las vistas se dibujan como planos: fondo de papel (o *blueprint* en tema oscuro), piezas en relleno plano con aristas y contornos en tinta, cámara ortográfica. La **instalación** pasa a un isométrico de cañerías con tags de equipos (TK-01, P-101A/B, V-01, TK-02), números de línea con DN y velocidad, flechas de flujo, cotas de nivel ▽ y burbujas PI en vivo. |
| Vista **Diseño**, cortes | **A-A** (transversal, perpendicular al eje: espiral de la voluta, lengua, álabes cortados y garganta acotada) y **B-B** (meridional, por el eje: perfil del rodete con b1, b2, D1 y D2, sección de la voluta, anillo de desgaste, prensaestopas y eje). Un control mueve el plano y otro gira el meridional. Las caras cortadas se rayan según ISO 128: carcasa a 45°, rodete a −45°, anillo de desgaste con rayado denso y eje sin rayar. Cotas con flechas, ejes en trazo y punto, traza del corte con flechas y letras, y en Plano un **cajetín** con vista, escala aproximada y punto de diseño. **Descargar plano (PNG)** guarda la vista con cotas y cajetín. |
| Visor 3D, **Bomba** | Voluta de sección circular creciente con lengua y descarga vertical, rodete cerrado con álabes curvados, soporte de cojinetes, acople, motor y base. El **corte** abre media carcasa con un plano de corte. Las partículas siguen el flujo en el marco absoluto (c) o en el del rodete (w); en este último solo se dibuja el flujo en los canales y la carcasa queda fija. Cuando cavita aparecen burbujas en el borde de ataque. En serie o paralelo, un selector elige la bomba 1 o la 2. |

Atajos: `1`–`5` pestañas · `B` 3D/Plano · `D` diseño · `V` instalación/bomba · `F` flujo · `C` marco · `X` corte · `R` cámara · `P` parámetros · `T` tema · `?` ayuda.

## Ejemplos (entradas → salidas esperadas)

| Caso | Entradas | Resultado |
|---|---|---|
| Didáctica, valores por defecto | 1450 rpm, D2 320 mm, β2 25°, z 7; H_geo 15 m; agua a 20 °C al nivel del mar | Q ≈ 180 m³/h, H ≈ 31.6 m, ηT ≈ 80 %, P ≈ 19 kW, ANPAd ≈ 11.7 m, ANPAr ≈ 2.3 m: no cavita |
| Agua caliente aspirando | Igual, con T = 85 °C y Hs = −4 m | ANPAd ≈ 0.2 m < ANPAr ≈ 2.3 m: **cavita** (aparece el aviso, la zona sombreada y las burbujas) |
| Preset Ruhrpumpen | 1475 rpm, a 240 m³/h | H ≈ 102 m y η ≈ 80.5 % (hoja de ensayo: 101.3 m y 80.2 %); ns ≈ 44, rodete radial lento |
| Cañerías a Q de diseño | Didáctica, una bomba (Q_d = 180 m³/h) | Aspiración 10"-AS-001 (DN250, 0.98 m/s), descarga 8"-DE-002 (DN200, 1.55 m/s) |
| Preset CM5-2 (TP 4) | 2850 rpm (supuesta), 2 etapas, potencia eléctrica | Modelo contra el ensayo: H dentro del 3 %, η del conjunto ±1.5 puntos, P eléctrica ±4 %; η de la bomba sola 50 % (catálogo) |
| CSV de la guía del TP | `Q [l/min];Ps [kg/cm2];Pe [mmHg];V [v];I [A];Cosφ` con `0;1,80;0;221,2;1,403;0,990` | H = 18.0 m, P = 307 W (la primera fila del TP 4) |
| Afinidad (apunte, p. 37) | 1150 → 1750 rpm, Q 612 gpm, H 35 ft, P 9 hp | 931 gpm, 81 ft, 32 hp; NPSH 3.5 → 7.1 ft (∝ n^1.7) |

## Arquitectura

```
index.html ── src/main.js ─┬─ physics/fluid.js       agua (ρ, pv por Antoine) y presión atmosférica (ISA)
                           ├─ physics/pump.js        Euler + resbalamiento, pérdidas, fugas, ANPAr, BEP
                           ├─ physics/system.js      curva del sistema, punto de funcionamiento, ANPAd
                           ├─ physics/combine.js     serie y paralelo
                           ├─ physics/similarity.js  afinidad, ns / nq / Ns, Φ, Ψ, tipo de rodete
                           ├─ physics/testSheet.js   ensayos Ruhrpumpen (p. 48) y TP 4 (p. 49), afinidad, tolerancia HI
                           ├─ physics/csvTest.js     lectura de ensayos en CSV (procesado o planilla del TP)
                           ├─ physics/fit.js         ajuste del modelo a un ensayo (Nelder–Mead acotado)
                           ├─ physics/piping.js      DN de cada línea por velocidad (Sch 40), números de línea
                           ├─ scene/plantScene.js    instalación: tanques, cañerías, válvula, serie/paralelo, manómetros
                           ├─ scene/pumpScene.js     bomba por dentro: rodete, voluta, motor, corte, flujo, burbujas
                           ├─ scene/designScene.js   diseño a escala real, cortes A-A / B-B, cotas, fantasma
                           ├─ scene/solids.js        sólidos cerrados (carcasa, rodete, álabes) sin three.js
                           ├─ scene/sectionCaps.js   relleno rayado de los cortes (capping por stencil)
                           ├─ scene/drawingStyle.js  estilo Plano: relleno plano, aristas, contornos, tags, ▽, PI
                           ├─ scene/pumpGeometry.js  geometría compartida: álabes, tapa, voluta
                           └─ ui/                    curvas, pestañas, P&ID (pidPane), cajetín y PNG (titleBlock)
```

Flujo de datos en cada cambio:

```
parámetros ─▶ buildPump(spec) (calibración en el punto de diseño, solo si cambia el diseño)
           ─▶ pump.at(Q, {n, D2, ρ}) ─▶ curva de la bomba o del conjunto (serie/paralelo)
           ─▶ operatingPoint(curva, sistema) ─▶ KPIs, curvas, triángulos, 3D
           ─▶ npshAvailable vs NPSHr ─▶ estado de cavitación ─▶ aviso, zona, burbujas
```

## Diseño técnico

- **Convenciones del apunte 13:**
  - Estaciones 1 (entrada) y 2 (salida); c, w y u, con componentes cm y cu.
  - **β medido desde la tangente** (β2 < 90° es álabe hacia atrás) y entrada sin prerrotación.
  - ANPAd y ANPAr; τ = ANPAr/H; ηT = ηh·ηv·ηm.
- **Euler:** H_t∞ = U2·(U2 − cm2·cot β2)/g. El resbalamiento usa el factor de **Wiesner**, σ = 1 − √(sin β2)/z^0.7. El apunte no trae corrección por número finito de álabes, así que la UI lo aclara y se puede desactivar.
- **Curva real:** H = H_TR − k_f·Q² − k_i·(Q − Q_choque)². Son las dos pérdidas del apunte (fricción y choque). β1 se diseña para que no haya choque en el Q de diseño. Las constantes se calibran una sola vez con ηh, ηv y ηm de diseño, y no dependen de n, así que el modelo cumple las leyes de afinidad **exactamente** en puntos homólogos (hay un test que lo verifica).
- **Fugas y pérdidas mecánicas:**
  - Fugas por los anillos de desgaste: q ∝ √H_TR.
  - Rozamiento de disco y mecánico: ∝ ρ·n³·D2⁵.
- **ANPAr:** correlación (λc·cm1² + λw·w1²)/(2g), con λc = 1.1 y λw = 0.25 (Pfleiderer/Gülich; no está en el apunte). Crece con Q, como en el apunte. Escala con n², mientras que la regla empírica del apunte es n^1.7; las dos están disponibles.
- **ANPAd:** Hs + Ha − Hf − Hpv (apunte, p. 40). Ha sale de la atmósfera ISA según la altitud y Hpv de Antoine según la temperatura. Margen del apunte: ANPAr < 60 % de ANPAd.
- **Instalación:**
  - `pressureProfile()` da la presión manométrica en cada punto (tanque, aspiración, entre bombas, descarga, válvula, llegada). Con ella se dibujan los manómetros y el color del flujo; cierra en 0 en el tanque abierto de descarga.
  - Aspiración común: ANPAd se calcula con el caudal total.
  - H_sist = H_geo + (K_cañería + K_válvula)·Q², con K_válvula ∝ 1/apertura².
  - El punto de funcionamiento se busca por bisección.
  - Serie: alturas sumadas a igual Q. Paralelo: caudales sumados a igual H; una bomba más débil no aporta por encima de su altura a caudal cero.
- **Voluta:** la garganta se dimensiona con vórtice libre para el caudal de diseño: Q = c2u·R2·A/R_c (`voluteThroat`).
- **3D:**
  - **Álabes:** curvatura dθ/dr = −1/(r·tan β) con β de β1 a β2.
  - **Flujo:** de línea media. Axial en la aspiración; siguiendo el canal en el marco del rodete; vórtice libre (cu ∝ 1/r) en la voluta; recto en la tobera.
  - **Cámara lenta común** para el rodete y las partículas, elegida para que el rodete no "rebobine" (efecto rueda de carreta).
- **Ajuste a ensayos (`fitPump`):** se mantienen β2, z y las proporciones de la bomba base y se ajustan D2, b2/D2, Q de diseño, ηh, la relación de choque y ηm. Se minimizan los errores relativos de H y, si están, los de η y P, con Nelder–Mead sobre parámetros acotados (transformación sigmoide) y reinicios. Con potencia eléctrica se suma un motor: P_el = P0 + P_eje/η_motor. Como con esa sola medición el reparto entre motor y bomba no queda determinado, se puede fijar el η máximo de la bomba sola del catálogo. Las bombas **multietapa** se modelan como etapas iguales en serie: la altura y la potencia se multiplican, y las velocidades y la ANPAr son las de una etapa.
- **TP 4:** según la guía del TP, la bomba del laboratorio es una Grundfos CM5-2 (dos etapas, 1×230 V, 50 Hz). Los puntos se leyeron del gráfico del apunte a 300 ppp (±2 %), y la velocidad (2850 rpm) es supuesta. El η máximo de la bomba sola (≈ 50 %) sale de la curva de catálogo de la guía.
- **Cañerías:** cada línea toma el menor diámetro nominal (Sch 40) con velocidad ≤ 1.5 m/s en la aspiración (para cuidar la ANPAd) y ≤ 2.5 m/s en la descarga, dimensionada con el caudal de diseño; en paralelo los colectores llevan el doble que los ramales. La velocidad que muestran los tags es la del punto de funcionamiento.
- **Plano y cortes:**
  - Para poder cortarlas, todas las piezas son **sólidos cerrados con espesor**. La carcasa barre alrededor del eje un perfil meridional (tobera de aspiración, pared frontal, voluta abierta hacia el rodete, pared trasera y prensaestopas) con ρ creciente de la lengua a la garganta. La tapa trasera y el cubo, la tapa delantera con su cuello, el anillo de desgaste y los álabes también son sólidos. `solids.js` no usa three.js, y los tests verifican que cada sólido sea estanco y con orientación consistente.
  - **Capping por stencil:** por cada grupo de piezas, las caras traseras suman y las delanteras restan en el stencil, sin test de profundidad. Donde el plano cruza material el stencil queda distinto de cero, y ahí se dibuja el plano rayado del grupo, que además lo vuelve a cero. Un grupo por rayado.
  - **Contornos:** con la técnica de casco invertido (caras traseras desplazadas por la normal), así los tubos y las esferas tienen silueta desde cualquier ángulo. Las aristas vivas salen de `EdgesGeometry`.
  - **Escala del cajetín:** se calcula para una pantalla de 96 ppp y se redondea a la escala normal más cercana. Es aproximada.
- **Preset Ruhrpumpen:** se ajustó por mínimos cuadrados acotados a la hoja de ensayo del apunte (p. 48).
  - Altura: dentro del ~6 % en todos los puntos.
  - Punto garantizado: dentro del 1 %.
  - Rendimiento a carga parcial: el modelo da más que la hoja, porque no modela la recirculación a bajo caudal.
  - Contra los puntos homologados de la hoja (tests en `testSheet.test.mjs`): H dentro del 7.5 % (+7 % a 101 m³/h), garantizado +0.7 %. A caudal cero el modelo da mucha menos potencia que la medida (8 kW contra 35 kW), porque las pérdidas por recirculación y por disco a válvula cerrada están subestimadas.

**Límites:** las proporciones de la carcasa (espesores, tobera, prensaestopas, bridas) son ilustrativas, escaladas con D2; las únicas que salen del cálculo son la garganta de la voluta y el rodete. El flujo es de línea media (no hay método de paneles álabe a álabe como en Turbofan Lab) y no se modelan la viscosidad, la recirculación ni la curva inestable de los álabes hacia adelante más allá de la forma de H–Q.

## Referencias

- F. González, *Apuntes de Turbomáquinas*: 13 Bombas dinámicas (Rev 2.6), 08 Análisis dimensional y coeficientes característicos, 02 Transformación de energía.
- C. Mataix, *Mecánica de fluidos y máquinas hidráulicas*.
- J. F. Gülich, *Centrifugal Pumps* (resbalamiento, ANPAr, recirculación).
- F. J. Wiesner (1967), *A review of slip factors for centrifugal impellers*, ASME J. Eng. Power.
- S. L. Dixon & C. A. Hall, *Fluid Mechanics and Thermodynamics of Turbomachinery* (velocidad específica, Cordier).
- Guía del TP *Ensayo de bomba centrífuga* (Turbomáquinas 6720, Rev A): Grundfos CM5-2, planilla de ensayo, ISO 9906 (NPSH3).
- ANSI/ISA-5.1, *Instrumentation Symbols and Identification* (burbujas PI, símbolos del P&ID).
- ISO 128-3 / ISO 128-50, *Technical drawings* (líneas, cortes y rayados).
- ASME B36.10M, *Welded and Seamless Wrought Steel Pipe* (diámetros interiores Sch 40).
- Three.js: https://threejs.org/docs/ · ejemplo de capping por stencil: https://threejs.org/examples/#webgl_clipping_stencil
