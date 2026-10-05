# Adapted from SOL12-NET/tor-monitor at 23fb06810e20fac08a1415caa0ab4a89c08ec726.
"""Health evaluation service with explicit Tor relay operational rules."""

from __future__ import annotations

import datetime
import threading
from typing import Any


FLAG_DESCRIPTIONS = {
    "Running": "Le relais est actuellement en ligne et actif dans le consensus.",
    "Valid": "Le descripteur du relais est valide et approuvé par les autorités d'annuaire.",
    "Fast": "Le relais dispose d'une bande passante suffisante pour acheminer le trafic standard.",
    "Stable": "Le relais a une bonne disponibilité et un faible taux de déconnexion.",
    "Guard": "Le relais est désigné comme Guard (relais d'entrée sécurisé pour les clients).",
    "HSDir": "Le relais héberge l'annuaire des services cachés / onions (nécessite ~96h d'uptime).",
    "V2Dir": "Le relais prend en charge le protocole d'annuaire Tor v2.",
}

CRITICAL_FLAGS = {"Running", "Valid", "Fast"}
DESIRED_FLAGS = {"Running", "Valid", "Fast", "Stable", "Guard", "HSDir", "V2Dir"}
HSDIR_UPTIME_THRESHOLD_SECONDS = 96 * 3600  # 96 hours = 345,600 seconds


class NetworkLivenessTracker:
    """In-memory tracker to prevent flapping on transient Tor network-liveness down signals."""

    def __init__(self, threshold_count: int = 3, threshold_seconds: float = 90.0):
        self.threshold_count = threshold_count
        self.threshold_seconds = threshold_seconds
        self.consecutive_down = 0
        self.first_down_timestamp: float | None = None
        self._lock = threading.Lock()

    def record_measurement(self, is_up: bool, now: float | None = None) -> tuple[bool, int, float | None]:
        """Record a new liveness check from Tor collection loop.

        Returns: (is_persistent_down, consecutive_down_count, first_down_timestamp)
        """
        import time
        current_time = time.time() if now is None else now
        with self._lock:
            if is_up:
                self.consecutive_down = 0
                self.first_down_timestamp = None
                return False, 0, None

            self.consecutive_down += 1
            if self.first_down_timestamp is None:
                self.first_down_timestamp = current_time

            elapsed = current_time - self.first_down_timestamp
            is_persistent = (
                self.consecutive_down >= self.threshold_count
                or elapsed >= self.threshold_seconds
            )
            return is_persistent, self.consecutive_down, self.first_down_timestamp

    def record(self, is_up: bool, now: float | None = None) -> tuple[bool, int, float | None]:
        """Alias for record_measurement."""
        return self.record_measurement(is_up, now=now)

    def get_state(self, now: float | None = None) -> tuple[bool, int, float | None]:
        """Read-only check for /api/status. Does NOT increment the counter."""
        import time
        current_time = time.time() if now is None else now
        with self._lock:
            if self.consecutive_down == 0 or self.first_down_timestamp is None:
                return False, 0, None

            elapsed = current_time - self.first_down_timestamp
            is_persistent = (
                self.consecutive_down >= self.threshold_count
                or elapsed >= self.threshold_seconds
            )
            return is_persistent, self.consecutive_down, self.first_down_timestamp

    def reset(self) -> None:
        """Reset down counter and timestamp."""
        with self._lock:
            self.consecutive_down = 0
            self.first_down_timestamp = None


liveness_tracker = NetworkLivenessTracker()


def parse_bootstrap_percent(raw: Any) -> int | None:
    """Parse integer bootstrap percentage from Tor status/bootstrap-phase string or int."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    raw_str = str(raw).strip()
    if not raw_str:
        return None
    import re
    match = re.search(r"PROGRESS=(\d+)", raw_str, re.IGNORECASE)
    if match:
        return int(match.group(1))
    if raw_str.isdigit():
        return int(raw_str)
    return None


def evaluate_relay_health(
    control_connected: bool,
    stem_info: dict[str, Any],
    onionoo_details: dict[str, Any],
    control_port: int | None = None,
    is_startup: bool = False,
    current_time: float | None = None,
    tracker: NetworkLivenessTracker | None = None,
) -> dict[str, Any]:
    """Evaluate relay health against strict explicit operational rules.

    Returns overall status ('OK', 'DEGRADED', 'DOWN', 'STARTING') and detailed criteria.
    """
    control_port = control_port or 9052
    active_tracker = tracker or liveness_tracker

    # Rule 5: Ignore stem_info completely if not connected
    if not control_connected:
        stem_info = {}

    rules: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []

    # 1. ControlPort Reachability
    if not control_connected:
        if is_startup:
            rules.append({
                "id": "control_port",
                "name": "Connexion ControlPort",
                "status": "STARTING",
                "message": f"Démarrage en cours... Connexion au ControlPort ({control_port}) en cours.",
            })
        else:
            rules.append({
                "id": "control_port",
                "name": "Connexion ControlPort",
                "status": "FAIL",
                "message": f"Le ControlPort ({control_port}) est injoignable.",
            })
    else:
        rules.append({
            "id": "control_port",
            "name": "Connexion ControlPort",
            "status": "PASS",
            "message": f"ControlPort {control_port} joignable et authentifié en lecture seule.",
        })

    # 2. Circuit Established & Bootstrap Progression
    circuit_ok = stem_info.get("status/circuit-established") == "1"
    raw_bootstrap = stem_info.get("status/bootstrap-phase")
    bootstrap_pct = parse_bootstrap_percent(raw_bootstrap)
    is_bootstrapping = bootstrap_pct is not None and bootstrap_pct < 100

    if is_bootstrapping:
        c_status = "PENDING"
        c_msg = f"Démarrage en cours (bootstrap {bootstrap_pct} %)"
    elif is_startup:
        c_status = "PENDING"
        c_msg = "Démarrage en cours... En attente de l'établissement du premier circuit."
    elif circuit_ok:
        c_status = "PASS"
        c_msg = "Circuit client propre établi pour tester la connectivité."
    else:
        c_status = "INFO"
        c_msg = "Aucun circuit client propre (normal sur un relais)."
    rules.append({
        "id": "circuit_established",
        "name": "Circuit Tor établi",
        "status": c_status,
        "message": c_msg,
    })

    # 3. ORPort Reachability
    or_ok = stem_info.get("status/reachability-succeeded/or") == "1"
    if not or_ok and is_startup:
        or_status = "STARTING"
        or_msg = "Démarrage en cours... Test d'accessibilité ORPort 9001 en attente."
    else:
        or_status = "PASS" if or_ok else "FAIL"
        or_msg = "L'auto-test d'accessibilité de l'ORPort 9001 a réussi." if or_ok else "L'ORPort 9001 ne semble pas joignable depuis l'extérieur."
    rules.append({
        "id": "or_port_reachability",
        "name": "Accessibilité ORPort (9001)",
        "status": or_status,
        "message": or_msg,
    })

    # 4. Network Liveness (Anti-flapping: >= 3 consecutive checks or >= 90s required before DOWN)
    raw_liveness = stem_info.get("network-liveness")
    net_down = False
    if not raw_liveness:
        rules.append({
            "id": "network_liveness",
            "name": "Connectivité Réseau",
            "status": "STARTING" if is_startup else "UNKNOWN",
            "message": "Démarrage en cours... En attente de connectivité réseau." if is_startup else "État de connectivité réseau non disponible.",
        })
    else:
        is_up = raw_liveness.strip().lower() == "up"
        if is_up:
            rules.append({
                "id": "network_liveness",
                "name": "Connectivité Réseau",
                "status": "PASS",
                "message": "La couche réseau Tor signale un état actif (up).",
            })
        else:
            is_persistent_down, down_count, _ = active_tracker.get_state(now=current_time)
            display_count = max(down_count, 1)
            if is_persistent_down:
                net_down = True
                rules.append({
                    "id": "network_liveness",
                    "name": "Connectivité Réseau",
                    "status": "FAIL",
                    "message": f"La connectivité réseau est suspendue (down persistant depuis {display_count} vérifications).",
                })
            else:
                rules.append({
                    "id": "network_liveness",
                    "name": "Connectivité Réseau",
                    "status": "WARN",
                    "message": f"Connectivité réseau incertaine ({display_count} échec{'s' if display_count > 1 else ''})",
                })

    # 5. Directory Info
    dir_info_ok = stem_info.get("status/enough-dir-info") == "1"
    rules.append({
        "id": "directory_info",
        "name": "Informations d'annuaire",
        "status": "PASS" if dir_info_ok else "WARN",
        "message": "Le relais possède suffisamment de documents d'annuaire." if dir_info_ok else "Documents d'annuaire en cours de synchronisation.",
    })

    # 6. Server Descriptor Accepted
    desc_accepted = (
        stem_info.get("status/accepted-server-descriptor") == "1"
        or stem_info.get("status/good-server-descriptor") == "1"
        or stem_info.get("status/descriptor-published") == "1"
    )
    rules.append({
        "id": "descriptor_published",
        "name": "Descripteur serveur accepté",
        "status": "PASS" if desc_accepted else "WARN",
        "message": "Le descripteur du relais a été accepté par les autorités." if desc_accepted else "En attente d'acceptation du descripteur par les autorités.",
    })

    # 7. Tor Version Status
    version_str = stem_info.get("version") or onionoo_details.get("version")
    version_status = stem_info.get("status/version/current") or onionoo_details.get("version_status")
    version_warn = False
    if not version_status:
        rules.append({
            "id": "tor_version",
            "name": "Version Tor recommandée",
            "status": "UNKNOWN",
            "message": f"Version {version_str or 'Inconnue'} (statut de version non disponible).",
        })
    else:
        version_pass = version_status in ["recommended", "new in series"]
        rules.append({
            "id": "tor_version",
            "name": "Version Tor recommandée",
            "status": "PASS" if version_pass else "WARN",
            "message": f"Version {version_str or 'Inconnue'} ({version_status})." if version_pass else f"Version {version_str or 'Inconnue'} non recommandée ({version_status}).",
        })
        if not version_pass:
            version_warn = True
            alerts.append({
                "type": "warning",
                "message": f"La version de Tor ({version_str or 'Inconnue'}) est signalée comme '{version_status}'. Une mise à jour est recommandée.",
            })

    # 8. Overload General
    is_overloaded = False
    if not onionoo_details:
        rules.append({
            "id": "overload",
            "name": "Absence de surcharge (Overload)",
            "status": "UNKNOWN",
            "message": "Données de surcharge non disponibles (Onionoo inaccessible).",
        })
    else:
        overload_ts = onionoo_details.get("overload_general_timestamp")
        if overload_ts:
            is_overloaded = True
            rules.append({
                "id": "overload",
                "name": "Absence de surcharge (Overload)",
                "status": "WARN",
                "message": f"Surcharge générale signalée par Onionoo à {overload_ts}.",
            })
            alerts.append({
                "type": "warning",
                "message": f"Surcharge générale signalée le {overload_ts}. Vérifiez la bande passante ou le CPU.",
            })
        else:
            rules.append({
                "id": "overload",
                "name": "Absence de surcharge (Overload)",
                "status": "PASS",
                "message": "Aucune surcharge signalée au réseau.",
            })

    # Flags Evaluation
    current_flags: list[str] = onionoo_details.get("flags", [])
    flags_set = set(current_flags)

    flags_detail = []
    for flag_name, desc in FLAG_DESCRIPTIONS.items():
        present = flag_name in flags_set
        flags_detail.append({
            "name": flag_name,
            "description": desc,
            "present": present,
            "critical": flag_name in CRITICAL_FLAGS,
        })

    # Check for missing critical flags
    missing_critical = CRITICAL_FLAGS - flags_set
    if missing_critical:
        alerts.append({
            "type": "error",
            "message": f"Drapeaux critiques manquants : {', '.join(missing_critical)}.",
        })

    # Uptime & HSDir Countdown
    uptime_raw = stem_info.get("uptime")
    uptime_seconds: int | None = None
    if uptime_raw is not None:
        try:
            uptime_seconds = int(uptime_raw)
        except (ValueError, TypeError):
            uptime_seconds = None

    hsdir_has_flag = "HSDir" in flags_set
    if uptime_seconds is None:
        uptime_formatted = "n/d"
        hsdir_ready = False
        hsdir_status = "active" if hsdir_has_flag else "unknown"
        hsdir_countdown_seconds = 0 if hsdir_has_flag else None
        hsdir_progress = 100.0 if hsdir_has_flag else None
    else:
        days = uptime_seconds // 86400
        hours = (uptime_seconds % 86400) // 3600
        minutes = (uptime_seconds % 3600) // 60
        uptime_formatted = f"{days}j {hours:02d}h {minutes:02d}m"
        hsdir_ready = uptime_seconds >= HSDIR_UPTIME_THRESHOLD_SECONDS

        if hsdir_has_flag:
            hsdir_status = "active"
            hsdir_countdown_seconds = 0
            hsdir_progress = 100.0
        elif hsdir_ready:
            hsdir_status = "eligible"
            hsdir_countdown_seconds = 0
            hsdir_progress = 100.0
        else:
            hsdir_status = "building"
            hsdir_countdown_seconds = HSDIR_UPTIME_THRESHOLD_SECONDS - uptime_seconds
            hsdir_progress = round((uptime_seconds / HSDIR_UPTIME_THRESHOLD_SECONDS) * 100.0, 1)

    # Global Status Determination
    onionoo_available = bool(onionoo_details)

    # Blocking failure rules: ControlPort down or ORPort reachability failed
    blocking_rule_failed = not control_connected or not or_ok
    blocking_rule_in_fail = any(
        r["id"] in ("control_port", "or_port_reachability") and r["status"] == "FAIL"
        for r in rules
    )

    # 1. DOWN conditions:
    # - Any blocking rule in FAIL (ControlPort or ORPort reachability)
    # - Blocking rule failed outside startup grace period
    # - Persistent network-liveness down (after anti-flapping threshold)
    # - Relay confirmed not Running in active consensus
    if blocking_rule_in_fail:
        overall_status = "DOWN"
    elif blocking_rule_failed and not is_startup:
        overall_status = "DOWN"
    elif net_down or (onionoo_available and "Running" not in flags_set):
        overall_status = "DOWN"

    # 2. STARTING conditions:
    # - Bootstrapping in progress (< 100%)
    # - Or initial startup grace period before first collection (even if bootstrap read failed)
    elif is_bootstrapping or is_startup:
        overall_status = "STARTING"

    # 3. DEGRADED conditions:
    # - Onionoo unavailable
    # - Missing critical flags
    # - Tor version warning
    # - Overload reported
    # - Any rule in WARN (excluding circuit_established which is informative / INFO)
    elif (
        not onionoo_available
        or missing_critical
        or version_warn
        or is_overloaded
        or (uptime_seconds is not None and hsdir_ready and not hsdir_has_flag and uptime_seconds > (120 * 3600))
        or any(r["status"] == "WARN" and r["id"] != "circuit_established" for r in rules)
    ):
        overall_status = "DEGRADED"
        if not onionoo_available:
            alerts.append({
                "type": "warning",
                "message": "Données réseau Onionoo temporairement indisponibles. Métriques Stem locales prioritaires.",
            })
    else:
        overall_status = "OK"

    return {
        "status": overall_status,
        "uptime_seconds": uptime_seconds,
        "uptime_formatted": uptime_formatted,
        "rules": rules,
        "flags": flags_detail,
        "active_flags_count": len(flags_set),
        "hsdir": {
            "status": hsdir_status,
            "has_flag": hsdir_has_flag,
            "countdown_seconds": hsdir_countdown_seconds,
            "progress_percent": hsdir_progress,
            "threshold_seconds": HSDIR_UPTIME_THRESHOLD_SECONDS,
        },
        "alerts": alerts,
        "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
