# SOL12 Freedom

Site de présentation de SOL12 et page **Our Tor Relays**, avec un collecteur indépendant connecté directement aux relais Tor. Le frontend reste en HTML/CSS/JavaScript sans compilation.

## Données et architecture

- `relays.json` : registre public des relais (nom, empreinte, lien vers les statistiques).
- `backend/control.py` : connexion directe au ControlPort, authentification SAFECOOKIE, commandes de lecture autorisées, événements BW à la seconde et vérifications toutes les 20 secondes.
- `backend/health.py` : règles d'état reprises de `SOL12-NET/tor-monitor`, commit `23fb06810e20fac08a1415caa0ab4a89c08ec726`, avec un suivi de connectivité indépendant par relais.
- `backend/main.py` : collecte directe des données de consensus depuis Onionoo (cache mémoire d'une heure), API publique et fichiers du site.
- `GET /api/relays` : instantané des données déjà collectées ; aucune requête Tor ou Onionoo déclenchée par un visiteur.
- `GET /api/relays/live` : flux SSE des mesures BW, partagé entre les visiteurs. Les débits sont convertis d'octets/seconde en **Mbit/s** (`octets × 8 / 1 000 000`).
- `tor.sol12.net` : uniquement le lien vers les statistiques détaillées, jamais une source de données pour Freedom.

Les données restent en mémoire, sans base de données. Les mesures de débit de plus de 15 secondes sont masquées ; un état collecté de plus de 60 secondes est signalé comme indisponible. Une défaillance de télémétrie n'est pas assimilée à un relais hors ligne. Les états disponibles sont Operational, Degraded, Down, Starting et Unavailable. Le badge en haut utilise l'état réel, y compris sur la page d'accueil.

## Déploiement sur le VPS

La nouvelle collecte exige le backend : un simple hébergement de fichiers statiques ne peut pas lire le ControlPort.

1. Copier `.env.example` vers `.env` et vérifier les valeurs.
2. Vérifier le GID réel du cookie avec `stat -c '%g' /var/lib/docker/volumes/tor-docker_tor-data/_data/control_auth_cookie`, puis renseigner `TOR_COOKIE_GID`. Le conteneur reste non-root.
3. Reconstruire/recréer le service `sol12-freedom` avec `docker compose up -d --build`. Si ce nom est déjà géré par une autre stack Compose, y remplacer le service et y reporter les réseaux et le montage de cookie avant de le recréer ; ne pas lancer une deuxième stack concurrente.
4. Dans Nginx Proxy Manager, faire pointer `freedom.sol12.net` vers **http://sol12-freedom:8000** sur `nginx-proxy-manager_default` (le port interne change si l'ancien site écoutait sur 80).
5. Pour le flux SSE, ajouter dans la configuration avancée du proxy host :

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 60s;
```

6. Vérifier `/healthz`, `/api/relays`, puis `/relays.html`. Attendre la première collecte (au plus 20 secondes) et le chargement Onionoo. Vérifier que les débits évoluent et que le lien Full statistics ouvre tor.sol12.net.

Le service est connecté à `tor-docker_default` et `nginx-proxy-manager_default`. Il cible **tor-relay:9052**, le sidecar socat relayant vers le ControlPort local 9051. Aucun port de contrôle n'est publié. Seul le fichier `control_auth_cookie` est monté en lecture seule, jamais le volume contenant les clés du relais. Le collecteur vérifie aussi l'empreinte du relais après authentification. Après un redémarrage de Tor qui remplace le fichier cookie, recréer Freedom pour renouveler le montage : `docker compose up -d --force-recreate sol12-freedom`.

Le backend désactive les journaux HTTP d'accès et ne sert que les répertoires et fichiers publics autorisés. Les paramètres internes et le cookie ne sont jamais envoyés au navigateur. Garder une seule instance/worker Uvicorn pour partager les connexions et les caches mémoire.

## Ajouter un futur relais

1. Ajouter son `id` unique (minuscules et caractères alphanumériques/underscore), `nickname`, `fingerprint` et `stats_url` HTTPS dans `relays.json`.
2. Configurer `<ID>_CONTROL_HOST`, `<ID>_CONTROL_PORT` et `<ID>_COOKIE_PATH` dans `.env` (ID en majuscules).
3. Monter uniquement son cookie en lecture seule et connecter Freedom au réseau privé de ce relais. Adapter `group_add` si le cookie appartient à un autre groupe.
4. Reconstruire le conteneur. La carte et son flux de débit apparaissent automatiquement, sans modification du HTML ou du JavaScript.

## Développement et vérification

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt pytest
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 --no-access-log
```

Sur Linux/macOS, utiliser `.venv/bin/python`. Pour connecter un relais local, charger la configuration avec `--env-file .env` (supporté par uvicorn[standard]) et vérifier que le cookie est accessible. Sans ControlPort configuré, l'interface affiche honnêtement Unavailable ; aucune simulation n'est activée en production.

```powershell
python tests/check_site.py
node --check js/relays.js
.venv\Scripts\python -m pytest tests -q
```

Les tests vérifient le handshake SAFECOOKIE contre un faux serveur TCP, le blocage des commandes de mutation, les règles d'état, l'isolement des relais, la fraîcheur des données et la protection des fichiers privés.
