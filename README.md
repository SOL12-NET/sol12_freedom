# SOL12 // Défense du Chiffrement & de la Vie Privée

> **Infrastructure suisse de Middle Relais Tor haute performance face aux dérives de surveillance étatique.**

---

## 🛰️ Mission & Contexte

Face aux offensives répétées de l'Union Européenne contre le chiffrement fort et la liberté d'expression en ligne (*Chat Control*, déchiffrement forcé des messageries privées, censure administrative et traçage systématique des adresses IP), **SOL12 s'engage activement pour préserver l'anonymat et les libertés fondamentales sur Internet**.

Depuis la Suisse — juridiction indépendante protégée par l'Article 13 de la Constitution fédérale et la Loi fédérale sur la protection des données (LPD) —, nous finançons et opérons des **middle relais Tor durcis, ultra-rapides et strictement sans logs**.

---

## 🎨 Direction Artistique & Caractéristiques

- **Style SpaceX / Mission Control** hérité de [`tor-monitor`](https://github.com/SOL12-NET/tor-monitor) :
  - Palette sombre spatiale (`#000000`, surfaces `#080808`, bordures techniques `#1E1E1E`, accents cyan `#7DD3FC` et braise martienne `#F97316`).
  - Typographies télémétriques self-hosted : *Barlow Semi Condensed*, *Inter*, *JetBrains Mono*.
  - Cartes télémétriques avec indicateurs d'état en direct, compteurs d'activité et badges de consensus Tor.
- **Planète Mars 3D photoréaliste & Satellites (Phobos & Deimos)** héritée de [`sol12-website`](https://github.com/SOL12-NET/sol12-website) :
  - Rendu WebGL Three.js avec modèles 3D NASA de Phobos et Deimos en orbite équatoriale.
  - Calcul d'ombres portées douces sur la surface martienne et simulation d'éclipse solaire.
  - Inclinaison axiale réaliste de 25.2° et shader d'atmosphère fine.
  - Positionnement soigné : **Texte et manifeste à gauche, planète Mars interactive à droite**.
- **Simulateur de Circuit Tor Interactif** :
  - Démonstration pédagogique des 3 nœuds (Guard -> Middle Relay SOL12 -> Exit).
  - Détail dynamique de ce qui est connu et de ce qui est totalement masqué à chaque saut.
- **Télémétrie en Direct & Export JSON** :
  - Graphiques de débit live simulés avec sparklines canvas.
  - Copie 1-clic des empreintes (fingerprints) de relais.
  - Export de la télémétrie certifiée au format JSON.

---

## 📁 Structure du Projet

```text
happy-newton/
├── assets/                  # Modèles 3D NASA, textures 2K et images de fallback
│   ├── deimos.glb
│   ├── phobos.glb
│   ├── mars_texture_2k.jpg
│   └── mars_orbit_view.webp / .png
├── css/
│   ├── fonts.css            # Déclarations des polices hébergées localement
│   └── style.css            # Système de design télémétrique SpaceX Noir
├── fonts/                   # Polices woff2 (Barlow Semi Condensed, Inter, JetBrains Mono)
├── js/
│   ├── three.min.js         # Moteur de rendu 3D
│   ├── GLTFLoader.js        # Chargeur GLTF pour les lunes martiennes
│   ├── mars-globe.js        # Simulation orbitale et rendu Three.js
│   └── app.js               # Logique d'interface, simulateur et télémétrie
├── tests/
│   └── check_site.py        # Script de validation de l'intégrité des assets et liens
├── favicon.svg / .ico
├── index.html               # Page principale responsive
└── README.md
```

---

## 🚀 Démarrage Rapide

Le site est entièrement autonome, statique et ne requiert aucun bundler ou compilation :

```bash
# Lancement d'un serveur HTTP local (Python)
python -m http.server 8080

# Ou avec Node.js
npx serve .
```

Puis ouvrez votre navigateur sur `http://localhost:8080`.

---

## 🛡️ Vérification de l'Intégrité

Un script de test automatisé permet de vérifier l'absence de lien brisé ou d'asset manquant :

```bash
python tests/check_site.py
```
