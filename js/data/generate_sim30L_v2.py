#!/usr/bin/env python3
"""
Generate Sim30L - Physics-based continuation of N97CX to Runway 30L

This script:
1. Continues from N97CX at 19:02:48 with same turn radius/rate
2. Smoothly decelerates to target speed
3. Maintains descent rate until reaching target altitude
4. Transitions smoothly to runway centerline alignment
5. Calculates bank angle throughout

Author: Claude
"""

import math
from datetime import datetime, timedelta

# ============================================================
# CONFIGURATION PARAMETERS (adjust as needed)
# ============================================================

TARGET_SPEED_KTS = 100.0        # Target speed at threshold (knots)
TARGET_ALTITUDE_FT = 2213.0     # 2163 (rwy elev) + 50 ft
DESCENT_RATE_FPM = -800.0       # Descent rate (fpm, negative = descending)

# Runway 30L data
RWY_30L_THRESHOLD = (36.205081, -115.190543)
RWY_30L_HEADING = 314.5         # Runway heading for landing

# Start output from this time (data before matches N97CX)
OUTPUT_START_TIME = "2022-07-17T19:01:00"

# Split point - where simulation takes over from real data
SPLIT_TIME = "2022-07-17T19:02:51.5"

# Collision point - N97CX's interpolated position at split time (19:02:51.5)
# Precise values from linear interpolation between 19:02:51.195 and 19:02:51.547
COLLISION_POINT = {
    'lon': -115.1843952238,
    'lat': 36.2028430295,
    'alt': 2270.248736
}

# ============================================================
# CONSTANTS
# ============================================================

DEG_TO_RAD = math.pi / 180
RAD_TO_DEG = 180 / math.pi
METERS_PER_DEG_LAT = 110540
FEET_PER_METER = 3.28084
KNOTS_TO_FPS = 1.68781          # Knots to feet per second
G_FPS2 = 32.174                 # Gravity in ft/s^2

# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def haversine_distance_ft(lat1, lon1, lat2, lon2):
    """Distance in feet between two lat/lon points"""
    R = 6371000
    phi1, phi2 = lat1 * DEG_TO_RAD, lat2 * DEG_TO_RAD
    dphi = (lat2 - lat1) * DEG_TO_RAD
    dlambda = (lon2 - lon1) * DEG_TO_RAD
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    dist_m = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return dist_m * FEET_PER_METER

def compute_bearing(lat1, lon1, lat2, lon2):
    """Bearing from point 1 to point 2 in degrees (0-360)"""
    phi1 = lat1 * DEG_TO_RAD
    phi2 = lat2 * DEG_TO_RAD
    dlambda = (lon2 - lon1) * DEG_TO_RAD
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.atan2(y, x) * RAD_TO_DEG + 360) % 360

def destination_point(lat, lon, bearing_deg, distance_ft):
    """Calculate destination point given start, bearing, and distance in feet"""
    R = 6371000 * FEET_PER_METER  # Earth radius in feet
    phi1 = lat * DEG_TO_RAD
    lambda1 = lon * DEG_TO_RAD
    theta = bearing_deg * DEG_TO_RAD
    d = distance_ft / R

    phi2 = math.asin(math.sin(phi1) * math.cos(d) +
                     math.cos(phi1) * math.sin(d) * math.cos(theta))
    lambda2 = lambda1 + math.atan2(math.sin(theta) * math.sin(d) * math.cos(phi1),
                                    math.cos(d) - math.sin(phi1) * math.sin(phi2))
    return (phi2 * RAD_TO_DEG, lambda2 * RAD_TO_DEG)

def normalize_heading(hdg):
    """Normalize heading to 0-360"""
    while hdg < 0:
        hdg += 360
    while hdg >= 360:
        hdg -= 360
    return hdg

def signed_angle_diff(from_hdg, to_hdg):
    """Signed shortest angle from from_hdg to to_hdg. + = turn right, - = turn left"""
    diff = to_hdg - from_hdg
    while diff > 180:
        diff -= 360
    while diff < -180:
        diff += 360
    return diff

def bank_angle_from_turn(speed_kts, turn_rate_dps):
    """Calculate bank angle for given speed and turn rate.

    Formula: tan(bank) = V * omega / g
    Where V is in fps, omega in rad/s

    Returns bank in degrees (negative = left bank/left turn)
    """
    if abs(turn_rate_dps) < 0.01:
        return 0.0

    V_fps = speed_kts * KNOTS_TO_FPS
    omega_rad = turn_rate_dps * DEG_TO_RAD

    bank_rad = math.atan(V_fps * omega_rad / G_FPS2)
    return bank_rad * RAD_TO_DEG

def turn_rate_from_radius(speed_kts, radius_ft):
    """Calculate turn rate (deg/sec) for given speed and radius.

    omega = V / R (rad/s)
    """
    if radius_ft < 100:
        radius_ft = 100  # Prevent extreme values

    V_fps = speed_kts * KNOTS_TO_FPS
    omega_rad = V_fps / radius_ft
    return omega_rad * RAD_TO_DEG

def cubic_ease(t):
    """Cubic ease-in-out for smooth transitions. t in [0,1], returns [0,1]"""
    if t < 0.5:
        return 4 * t * t * t
    else:
        return 1 - pow(-2 * t + 2, 3) / 2

def latlon_to_xy_ft(lat, lon, origin_lat, origin_lon):
    """Convert lat/lon to XY feet with origin at specified point"""
    dlat = lat - origin_lat
    dlon = lon - origin_lon
    y_ft = dlat * METERS_PER_DEG_LAT * FEET_PER_METER
    x_ft = dlon * METERS_PER_DEG_LAT * math.cos(origin_lat * DEG_TO_RAD) * FEET_PER_METER
    return x_ft, y_ft

# ============================================================
# MAIN SIMULATION
# ============================================================

print("=" * 70)
print("GENERATING SIM30L - Physics-Based Approach Simulation")
print("=" * 70)

# Read N97CX data (from original file which has clean real flight data)
print("\n[1/5] Reading N97CX data...")
n97cx_data = []
with open('N97CX_xyz_original.csv', 'r') as f:
    header = f.readline()
    for line in f:
        parts = line.strip().split(',')
        if len(parts) >= 4:
            n97cx_data.append({
                'time': parts[0],
                'lon': float(parts[1]),
                'lat': float(parts[2]),
                'alt': float(parts[3])
            })

print(f"    Loaded {len(n97cx_data)} points from N97CX")

# Find split point index (use configured SPLIT_TIME)
split_idx = next((i for i, pt in enumerate(n97cx_data) if pt['time'] >= SPLIT_TIME), len(n97cx_data)-1)

# Find output start index (19:02:00)
start_idx = next((i for i, pt in enumerate(n97cx_data) if pt['time'] >= OUTPUT_START_TIME), 0)

print(f"    Output starts at index {start_idx} ({OUTPUT_START_TIME})")
print(f"    Split point at index {split_idx} ({n97cx_data[split_idx]['time']})")

# Copy N97CX data up to split point (NOT including split)
# The simulation will add the collision point as the first simulated point
sim_data = n97cx_data[:split_idx]

# Add the collision point as the last real data point
if COLLISION_POINT:
    sim_data.append({
        'time': SPLIT_TIME,
        'lon': COLLISION_POINT['lon'],
        'lat': COLLISION_POINT['lat'],
        'alt': COLLISION_POINT['alt']
    })
    print(f"    Copying {len(sim_data)-1} points from original data, plus collision point")

# Calculate state at split point from last few points
print("\n[2/5] Analyzing state at split point...")

# Get heading from last two points
pt_m2 = n97cx_data[split_idx - 2]
pt_m1 = n97cx_data[split_idx - 1]
pt_split = n97cx_data[split_idx]

heading_at_split = compute_bearing(pt_m1['lat'], pt_m1['lon'],
                                    pt_split['lat'], pt_split['lon'])

# Calculate turn rate from heading change
def parse_time_to_seconds(time_str):
    t = time_str.split('T')[1].split(':')
    return float(t[0]) * 3600 + float(t[1]) * 60 + float(t[2])

t_m1 = parse_time_to_seconds(pt_m1['time'])
t_split = parse_time_to_seconds(pt_split['time'])
dt = t_split - t_m1

hdg_m1 = compute_bearing(pt_m2['lat'], pt_m2['lon'], pt_m1['lat'], pt_m1['lon'])
hdg_change = signed_angle_diff(hdg_m1, heading_at_split)
turn_rate_at_split = hdg_change / dt if dt > 0 else -5.0

# Calculate groundspeed at split
dist_ft = haversine_distance_ft(pt_m1['lat'], pt_m1['lon'],
                                 pt_split['lat'], pt_split['lon'])
speed_fps = dist_ft / dt if dt > 0 else 113 * KNOTS_TO_FPS
speed_at_split = speed_fps / KNOTS_TO_FPS

# Calculate turn radius
radius_at_split = abs(speed_fps / (turn_rate_at_split * DEG_TO_RAD)) if abs(turn_rate_at_split) > 0.1 else 2050

# Bank angle at split
bank_at_split = bank_angle_from_turn(speed_at_split, turn_rate_at_split)

print(f"    Position:    ({pt_split['lat']:.6f}, {pt_split['lon']:.6f})")
print(f"    Altitude:    {pt_split['alt']:.0f} ft")
print(f"    Groundspeed: {speed_at_split:.1f} kts")
print(f"    Heading:     {heading_at_split:.1f}°")
print(f"    Turn Rate:   {turn_rate_at_split:.2f} °/s (negative = left)")
print(f"    Turn Radius: {radius_at_split:.0f} ft")
print(f"    Bank Angle:  {bank_at_split:.1f}°")

# Distance and bearing to runway
dist_to_rwy = haversine_distance_ft(pt_split['lat'], pt_split['lon'],
                                     RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])
bearing_to_rwy = compute_bearing(pt_split['lat'], pt_split['lon'],
                                  RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])

print(f"    Dist to Rwy: {dist_to_rwy:.0f} ft ({dist_to_rwy/6076:.2f} nm)")
print(f"    Bearing:     {bearing_to_rwy:.1f}°")

# Calculate required descent rate to reach target altitude at threshold
alt_to_lose = pt_split['alt'] - TARGET_ALTITUDE_FT
avg_speed_fps = ((speed_at_split + TARGET_SPEED_KTS) / 2) * KNOTS_TO_FPS
time_to_threshold = dist_to_rwy / avg_speed_fps
computed_descent_fpm = (alt_to_lose / time_to_threshold) * 60 if time_to_threshold > 0 else 600

print(f"\n    Computed descent rate for profile: {computed_descent_fpm:.0f} fpm")
print(f"    (Using configured: {DESCENT_RATE_FPM:.0f} fpm)")

# Use the computed descent rate (aircraft will level off at target altitude)
actual_descent_fpm = -computed_descent_fpm
print(f"    Actual descent rate used: {actual_descent_fpm:.0f} fpm")

# ============================================================
# SIMULATION LOOP
# ============================================================

print("\n[3/5] Running physics simulation...")

# Current state - use collision point position if defined
if COLLISION_POINT:
    lat = COLLISION_POINT['lat']
    lon = COLLISION_POINT['lon']
    alt = COLLISION_POINT['alt']
    print(f"\n    Using collision point: ({lat:.6f}, {lon:.6f}, {alt:.1f} ft)")
else:
    lat = pt_split['lat']
    lon = pt_split['lon']
    alt = pt_split['alt']
heading = heading_at_split
speed = speed_at_split
turn_rate = turn_rate_at_split  # deg/sec (negative = left turn)
# Use exact split time, not the time from data
# Handle fractional seconds properly
split_time_parts = SPLIT_TIME.split('.')
if len(split_time_parts) == 2:
    base_time = datetime.fromisoformat(split_time_parts[0])
    frac_secs = float('0.' + split_time_parts[1])
    current_time = base_time + timedelta(seconds=frac_secs)
else:
    current_time = datetime.fromisoformat(SPLIT_TIME)

# Get the actual bank angle from original data at split point for smooth transition
# We'll blend from this to the computed bank angle
original_bank_at_split = bank_at_split  # From turn rate calculation
# Try to read from original roll data
try:
    with open('N97CX_roll_original.csv', 'r') as f:
        split_secs = parse_time_to_seconds(pt_split['time'])
        prev_roll = None
        next_roll = None
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 2:
                try:
                    t_secs = parse_time_to_seconds(parts[0])
                    roll_val = float(parts[1])
                    if t_secs <= split_secs:
                        prev_roll = (t_secs, roll_val)
                    elif t_secs > split_secs and next_roll is None:
                        next_roll = (t_secs, roll_val)
                        break
                except:
                    pass
        if prev_roll:
            if next_roll and next_roll[0] != prev_roll[0]:
                t = (split_secs - prev_roll[0]) / (next_roll[0] - prev_roll[0])
                original_bank_at_split = prev_roll[1] + t * (next_roll[1] - prev_roll[1])
            else:
                original_bank_at_split = prev_roll[1]
        print(f"    Original bank at split: {original_bank_at_split:.1f}° (computed: {bank_at_split:.1f}°)")
except:
    pass

# Bank blending parameters
bank_blend_duration = 2.0  # seconds to blend from original to computed bank

# Simulation parameters
dt = 0.5  # Time step (seconds)
max_iterations = 200

# Phase tracking
# Phase 1: Continue turn, decelerate, descend
# Phase 2: Transition - roll out and turn right to align
# Phase 3: Final - track centerline to threshold

phase = 1
iteration = 0

# Track for rollout transition
rollout_start_iter = None
rollout_duration = 4.0  # seconds for cubic transition (faster for tighter intercept)

# Extended data storage (for output)
extended_data = []

# Track rollout state
rollout_started = False

while iteration < max_iterations:
    iteration += 1

    # Calculate current state
    dist_to_rwy = haversine_distance_ft(lat, lon, RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])
    bearing_to_rwy = compute_bearing(lat, lon, RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])
    hdg_to_rwy = signed_angle_diff(heading, bearing_to_rwy)
    hdg_to_centerline = signed_angle_diff(heading, RWY_30L_HEADING)

    # Calculate along-track distance (positive = behind threshold, negative = past threshold)
    dx = (lon - RWY_30L_THRESHOLD[1]) * METERS_PER_DEG_LAT * math.cos(RWY_30L_THRESHOLD[0] * DEG_TO_RAD) * FEET_PER_METER
    dy = (lat - RWY_30L_THRESHOLD[0]) * METERS_PER_DEG_LAT * FEET_PER_METER
    rwy_hdg_rad = RWY_30L_HEADING * DEG_TO_RAD
    along_track = -dx * math.sin(rwy_hdg_rad) - dy * math.cos(rwy_hdg_rad)

    # Calculate cross-track for stopping condition
    stop_cross_track = dx * math.cos(rwy_hdg_rad) - dy * math.sin(rwy_hdg_rad)
    hdg_error_to_rwy = abs(signed_angle_diff(heading, RWY_30L_HEADING))

    # Stop when aircraft is established on centerline with runway heading
    # or reaches the 1000 ft fixed distance marker
    on_centerline = abs(stop_cross_track) < 50  # Within 50 ft of centerline
    on_heading = hdg_error_to_rwy < 5  # Within 5° of runway heading
    at_1000ft_marker = along_track < -1000  # 1000 ft past threshold

    if at_1000ft_marker or (on_centerline and on_heading):
        print(f"    End: iter {iteration}, along_track={along_track:.0f} ft, cross_track={stop_cross_track:.0f} ft, hdg={heading:.1f}°")
        break

    # =================================================================
    # BANK-ANGLE-DRIVEN SIMULATION
    # The aircraft maintains its bank angle from the collision point,
    # then gradually rolls out to capture the runway centerline.
    # Turn rate is computed FROM bank angle (not the other way around).
    # =================================================================

    # Calculate cross-track and along-track to runway
    dx = (lon - RWY_30L_THRESHOLD[1]) * METERS_PER_DEG_LAT * math.cos(RWY_30L_THRESHOLD[0] * DEG_TO_RAD) * FEET_PER_METER
    dy = (lat - RWY_30L_THRESHOLD[0]) * METERS_PER_DEG_LAT * FEET_PER_METER
    rwy_hdg_rad = RWY_30L_HEADING * DEG_TO_RAD
    cross_track = dx * math.cos(rwy_hdg_rad) - dy * math.sin(rwy_hdg_rad)

    # Heading error to runway (positive = need to turn right, negative = need to turn left)
    hdg_to_runway = signed_angle_diff(heading, RWY_30L_HEADING)

    # Determine target bank angle based on situation
    # Strategy: Maintain original bank to continue turn toward extended centerline,
    # then roll out when close to centerline and intercept at an angle.

    if iteration == 1:
        # First iteration: use the original bank from collision point
        bank = original_bank_at_split  # About -27.6° (left bank)
        print(f"    Starting with bank={bank:.1f}°, hdg={heading:.1f}°, cross_track={cross_track:.0f} ft")

    else:
        # Rollout trigger: when cross_track gets small enough OR heading reaches intercept heading
        # cross_track > 0 means right of centerline, < 0 means left of centerline
        #
        # For a left base turn, we intercept the centerline from the right.
        # We should roll out when:
        # 1. cross_track is getting small (approaching centerline), OR
        # 2. heading has turned enough to be on an intercept course (about 30° off runway heading)

        intercept_heading = RWY_30L_HEADING - 5  # Intercept at ~5° angle (very shallow)
        hdg_past_intercept = heading < intercept_heading

        # Start rollout when cross_track drops below 200 ft OR heading passes intercept
        if cross_track > 200 and not hdg_past_intercept and not rollout_started:
            # Still right of centerline and not yet at intercept heading - continue turn
            target_bank = original_bank_at_split
            if iteration == 2:
                print(f"    Maintaining bank={target_bank:.1f}°, turning toward centerline, cross_track={cross_track:.0f} ft")

        else:
            # Close to centerline or at intercept heading - begin rollout
            if not rollout_started:
                rollout_started = True
                print(f"    Rollout at iter {iteration}, hdg={heading:.1f}°, cross_track={cross_track:.0f} ft")

            # Priority 1: Stop the left turn if we've turned too far
            # hdg_to_runway is positive when we need to turn right to reach runway heading
            if hdg_to_runway > 20:
                # Heading way off - prioritize turning right (rolling out)
                # Target wings level or slight right bank
                target_bank = min(8, hdg_to_runway * 0.4)  # Right bank to correct
            else:
                # Normal intercept logic - blend cross-track and heading correction
                # Positive cross_track = right of centerline = need left bank (negative)
                # Negative cross_track = left of centerline = need right bank (positive)

                # When close to centerline, prioritize heading alignment
                cross_track_abs = abs(cross_track)
                if cross_track_abs < 100:
                    # Very close to centerline - mostly heading correction
                    hdg_weight = 0.9
                    hdg_gain = 1.0  # Stronger heading correction
                elif cross_track_abs < 300:
                    # Getting close - blend evenly
                    hdg_weight = 0.7
                    hdg_gain = 0.8
                else:
                    # Far from centerline - prioritize cross-track
                    hdg_weight = 0.4
                    hdg_gain = 0.6

                intercept_bank = -cross_track / 50.0  # Gentler: 1° bank per 50 ft
                intercept_bank = max(-12, min(12, intercept_bank))

                # Heading correction to align with runway - stronger when close
                hdg_correction = hdg_to_runway * hdg_gain
                hdg_correction = max(-18, min(18, hdg_correction))

                target_bank = intercept_bank * (1 - hdg_weight) + hdg_correction * hdg_weight
                target_bank = max(-20, min(20, target_bank))

        # Bank rate depends on whether we're in rollout
        if rollout_started:
            # Faster roll during intercept to quickly correct
            # When heading error is large, roll even faster
            if hdg_to_runway > 20:
                max_bank_change = 8.0 * dt  # 8°/sec when need to stop turn fast
            else:
                max_bank_change = 5.0 * dt  # 5°/sec normal rollout
        else:
            max_bank_change = 3.0 * dt  # 3°/sec during turn

        bank_diff = target_bank - bank
        if abs(bank_diff) > max_bank_change:
            bank = bank + max_bank_change * (1 if bank_diff > 0 else -1)
        else:
            bank = target_bank

    # Compute turn rate FROM bank angle
    # Formula: tan(bank) = V * omega / g, so omega = g * tan(bank) / V
    V_fps = speed * KNOTS_TO_FPS
    if abs(bank) > 0.5:  # Avoid division issues near zero
        turn_rate = (G_FPS2 * math.tan(bank * DEG_TO_RAD) / V_fps) * RAD_TO_DEG
    else:
        turn_rate = 0.0

    # Decelerate smoothly toward target speed
    # Calculate deceleration based on distance remaining
    speed_error = speed - TARGET_SPEED_KTS
    if speed_error > 0 and dist_to_rwy > 100:
        # Deceleration to reach target speed at threshold
        # s = v*t - 0.5*a*t^2, where we want final speed = target
        # Simplified: decel proportional to speed error / distance remaining
        # Target: lose speed_error knots over dist_to_rwy feet
        time_to_threshold = dist_to_rwy / (speed * KNOTS_TO_FPS)  # seconds
        if time_to_threshold > 1:
            decel_rate = speed_error / time_to_threshold  # kts per second
            decel_rate = min(decel_rate, 2.0)  # Max 2 kts/sec decel
            decel_rate = max(decel_rate, 0.3)  # Min 0.3 kts/sec decel
            speed -= decel_rate * dt

    # Descend (using computed rate for proper profile)
    alt += (actual_descent_fpm / 60) * dt
    if alt < TARGET_ALTITUDE_FT:
        alt = TARGET_ALTITUDE_FT

    # Update heading
    heading = normalize_heading(heading + turn_rate * dt)

    # Update position
    dist_traveled_ft = speed * KNOTS_TO_FPS * dt
    lat, lon = destination_point(lat, lon, heading, dist_traveled_ft)

    # Update time
    current_time += timedelta(seconds=dt)

    # Store data point
    x_ft, y_ft = latlon_to_xy_ft(lat, lon, RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])

    sim_data.append({
        'time': current_time.strftime('%Y-%m-%dT%H:%M:%S.') + f'{current_time.microsecond // 1000:03d}',
        'lon': lon,
        'lat': lat,
        'alt': alt
    })

    extended_data.append({
        'time': current_time.strftime('%Y-%m-%dT%H:%M:%S.') + f'{current_time.microsecond // 1000:03d}',
        'lon': lon,
        'lat': lat,
        'alt': alt,
        'x_ft': x_ft,
        'y_ft': y_ft,
        'gs_kts': speed,
        'heading': heading,
        'bank_deg': bank,
        'turn_rate': turn_rate,
        'phase': phase
    })

print(f"    Simulation complete: {iteration} iterations, {len(sim_data)} total points")
print(f"    Final: lat={lat:.6f}, lon={lon:.6f}, alt={alt:.0f} ft")
print(f"    Final: hdg={heading:.1f}°, speed={speed:.1f} kts")

# ============================================================
# WRITE OUTPUT FILES
# ============================================================

print("\n[4/7] Writing N97CX_xyz.csv...")
with open('N97CX_xyz.csv', 'w') as f:
    for pt in sim_data:
        f.write(f"{pt['time']},{pt['lon']},{pt['lat']},{pt['alt']}\n")
print(f"    Wrote {len(sim_data)} rows")

# ============================================================
# GENERATE ROLL DATA (bank angles)
# ============================================================

print("\n[5/7] Generating N97CX_roll.csv...")

# Read ORIGINAL roll data (not the output file which gets overwritten)
original_roll_data = []
try:
    with open('N97CX_roll_original.csv', 'r') as f:
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 2:
                try:
                    time_str = parts[0]
                    roll_val = float(parts[1])
                    # Parse time to seconds for interpolation
                    t_parts = time_str.split('T')[1].split(':')
                    secs = float(t_parts[0]) * 3600 + float(t_parts[1]) * 60 + float(t_parts[2])
                    original_roll_data.append({'time': time_str, 'secs': secs, 'roll': roll_val})
                except:
                    pass
except FileNotFoundError:
    print("    WARNING: N97CX_roll_original.csv not found!")

# Sort roll data by time
original_roll_data.sort(key=lambda x: x['secs'])

def interpolate_roll(target_secs):
    """Interpolate roll value for a given time"""
    if not original_roll_data:
        return None
    prev = None
    next_r = None
    for r in original_roll_data:
        if r['secs'] <= target_secs:
            prev = r
        elif r['secs'] > target_secs and next_r is None:
            next_r = r
            break

    if prev is None:
        return original_roll_data[0]['roll'] if original_roll_data else None
    if next_r is None:
        return prev['roll']
    if prev['secs'] == target_secs:
        return prev['roll']

    # Linear interpolation
    t = (target_secs - prev['secs']) / (next_r['secs'] - prev['secs'])
    return prev['roll'] + t * (next_r['roll'] - prev['roll'])

# Build complete roll data
roll_output = []

# Add pre-split roll data with interpolation
for pt in sim_data[:len(sim_data) - len(extended_data)]:
    time_str = pt['time']
    t_parts = time_str.split('T')[1].split(':')
    secs = float(t_parts[0]) * 3600 + float(t_parts[1]) * 60 + float(t_parts[2])
    roll_val = interpolate_roll(secs)
    if roll_val is not None:
        roll_output.append((time_str, roll_val))

# Add simulated roll data
for pt in extended_data:
    roll_output.append((pt['time'], pt['bank_deg']))

with open('N97CX_roll.csv', 'w') as f:
    for time_str, bank in roll_output:
        f.write(f"{time_str},{bank:.1f}\n")
print(f"    Wrote {len(roll_output)} rows")

# ============================================================
# GENERATE GROUNDSPEED DATA (from positions)
# ============================================================

print("\n[6/7] Generating N97CX_gs.csv...")

gs_raw = []
prev_pt = None

def parse_time_ms(t):
    parts = t.split('T')[1].split(':')
    secs = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    return secs

for i, pt in enumerate(sim_data):
    if prev_pt is None:
        prev_pt = pt
        continue

    dt = parse_time_ms(pt['time']) - parse_time_ms(prev_pt['time'])
    if dt <= 0:
        prev_pt = pt
        continue

    # Calculate distance
    dist_ft = haversine_distance_ft(prev_pt['lat'], prev_pt['lon'], pt['lat'], pt['lon'])

    # Calculate groundspeed
    gs_fps = dist_ft / dt
    gs_kts = gs_fps / KNOTS_TO_FPS

    gs_raw.append((pt['time'], gs_kts))
    prev_pt = pt

# Apply 3-point moving average to smooth spikes (especially around split)
gs_output = []
for i, (time_str, gs) in enumerate(gs_raw):
    if i == 0:
        smoothed = (gs_raw[0][1] + gs_raw[1][1]) / 2 if len(gs_raw) > 1 else gs
    elif i == len(gs_raw) - 1:
        smoothed = (gs_raw[i-1][1] + gs_raw[i][1]) / 2
    else:
        smoothed = (gs_raw[i-1][1] + gs_raw[i][1] + gs_raw[i+1][1]) / 3
    gs_output.append((time_str, smoothed))

with open('N97CX_gs.csv', 'w') as f:
    for time_str, gs in gs_output:
        f.write(f"{time_str},{gs:.1f}\n")
print(f"    Wrote {len(gs_output)} rows")

# ============================================================
# WRITE EXTENDED CSV (for debugging/analysis)
# ============================================================

print("\n[7/7] Writing N97CX_extended.csv...")

# First, add XY to the N97CX portion (before split)
all_extended = []
for pt in sim_data[:len(sim_data) - len(extended_data)]:
    x_ft, y_ft = latlon_to_xy_ft(pt['lat'], pt['lon'],
                                  RWY_30L_THRESHOLD[0], RWY_30L_THRESHOLD[1])
    all_extended.append({
        'time': pt['time'],
        'lon': pt['lon'],
        'lat': pt['lat'],
        'alt': pt['alt'],
        'x_ft': x_ft,
        'y_ft': y_ft,
        'gs_kts': 0,  # Unknown for original data
        'heading': 0,
        'bank_deg': 0,
        'turn_rate': 0,
        'phase': 0
    })

# Add the simulated portion
all_extended.extend(extended_data)

with open('N97CX_extended.csv', 'w') as f:
    f.write("timeGE,Longitude,Latitude,AltMSL,X_ft,Y_ft,GS_kts,Heading_deg,Bank_deg,TurnRate_dps,Phase\n")
    for pt in all_extended:
        f.write(f"{pt['time']},{pt['lon']},{pt['lat']},{pt['alt']:.2f},"
                f"{pt['x_ft']:.2f},{pt['y_ft']:.2f},{pt['gs_kts']:.1f},"
                f"{pt['heading']:.1f},{pt['bank_deg']:.1f},{pt['turn_rate']:.2f},{pt['phase']}\n")
print(f"    Wrote {len(all_extended)} rows")

print("\n" + "=" * 70)
print("COMPLETE!")
print("=" * 70)
print(f"\nConfiguration used:")
print(f"  Target speed:    {TARGET_SPEED_KTS} kts")
print(f"  Target altitude: {TARGET_ALTITUDE_FT} ft")
print(f"  Descent rate:    {DESCENT_RATE_FPM} fpm")
print(f"\nTo adjust, edit the CONFIGURATION PARAMETERS at the top of this script.")
