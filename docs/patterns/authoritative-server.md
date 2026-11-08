# Authoritative Server

> The server owns the truth; clients send inputs and receive state.

**Category:** Networking & Multiplayer

## Problem

In the first multiplayer prototype, each client simulates its own player and tells the others "I'm at (10, 2, 5), I have 500 health, I hit player 3 for 9,999 damage". It works until someone edits memory or packets: they teleport, become immortal and kill everyone instantly. Even without cheating, two clients disagree about whether a shot hit, and both are "right" on their own screen. There is no single source of truth.

## Solution

One machine, the **server**, runs the real simulation and is the **only authority** on game state:

- **Clients send intentions, not results:** "I pressed forward", "I want to fire", "I want to buy item 12". Never "I'm at X" or "I dealt 50 damage".
- **The server validates** every request against its own state and the rules: is the move possible at this speed, is the weapon off cooldown, is the target in range and in sight, can the player afford the item?
- **The server simulates** and **sends state** to clients ([Snapshot & Delta Compression](./snapshot-delta-compression)).
- **Clients present** that state, and hide latency with [Client-Side Prediction](./client-side-prediction), [Server Reconciliation](./server-reconciliation), [Entity Interpolation](./entity-interpolation) and [Lag Compensation](./lag-compensation).

What may stay client-authoritative: purely cosmetic things that cannot affect others (camera, UI, particle effects, local footstep sounds).

The server can be **dedicated** (a headless build in a data centre: fair, scalable, costs money) or a **listen server/host** (one player's machine: free, but the host has zero latency and could cheat).

## Example

Server-side request handling. The client asks, and the server checks everything with its own data. The Unity tab is transport-agnostic; the Godot and Unreal tabs use each engine's built-in RPCs, which also tell the server **who** sent a request, so a client can't claim to be someone else.

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public enum RejectReason { None, OnCooldown, OutOfRange, NoLineOfSight, NotEnoughGold, InvalidTarget, TooFast }

public readonly struct FireRequest
{
    public readonly int PlayerId, TargetId, WeaponSlot;
    public readonly uint InputSequence;
    public FireRequest(int playerId, int targetId, int weaponSlot, uint seq)
    { PlayerId = playerId; TargetId = targetId; WeaponSlot = weaponSlot; InputSequence = seq; }
}

public class ServerCombat
{
    readonly ServerWorld world;                     // the server's own, authoritative state

    public ServerCombat(ServerWorld world) => this.world = world;

    // req.PlayerId must come from the connection the request arrived on, never from the payload.
    public RejectReason HandleFire(in FireRequest req)
    {
        // Never trust anything the client says about state: look it all up.
        if (!world.TryGetPlayer(req.PlayerId, out var shooter) || !shooter.IsAlive) return RejectReason.InvalidTarget;
        if (!world.TryGetPlayer(req.TargetId, out var target) || !target.IsAlive) return RejectReason.InvalidTarget;
        if (req.WeaponSlot < 0 || req.WeaponSlot >= shooter.Weapons.Length) return RejectReason.InvalidTarget;

        var weapon = shooter.Weapons[req.WeaponSlot];
        if (world.Time < weapon.ReadyAt) return RejectReason.OnCooldown;

        Vector3 from = shooter.EyePosition, to = target.CenterPosition;
        if (Vector3.Distance(from, to) > weapon.Range) return RejectReason.OutOfRange;
        if (world.Raycast(from, to, out _)) return RejectReason.NoLineOfSight;   // with lag compensation in shooters

        // Only now does the shot happen, with the server's own damage numbers.
        weapon.ReadyAt = world.Time + weapon.Cooldown;
        target.Health -= weapon.Damage;
        world.Broadcast(new HitEvent(req.PlayerId, req.TargetId, weapon.Damage));
        return RejectReason.None;
    }

    // Movement: the client sends inputs; the server simulates them, and also guards against impossible input.
    public void HandleMoveInput(ServerPlayer p, Vector2 move, float clientDt)
    {
        if (move.sqrMagnitude > 1.0001f) move.Normalize();                   // clamp tampered input
        float dt = Mathf.Min(clientDt, 1f / 20f);                            // can't claim huge time steps
        p.Position = world.MoveWithCollisions(p.Position, new Vector3(move.x, 0, move.y) * p.MoveSpeed * dt);
    }

    // Economy: transactions are checked and applied atomically on the server.
    public RejectReason HandleBuy(ServerPlayer p, int itemId)
    {
        var item = world.Shop.Find(itemId);
        if (item == null) return RejectReason.InvalidTarget;
        if (p.Gold < item.Price) return RejectReason.NotEnoughGold;
        p.Gold -= item.Price;
        p.Inventory.TryAdd(item.Definition, 1);
        return RejectReason.None;
    }
}

// ServerWorld / ServerPlayer: the server's simulation objects (not the client's MonoBehaviours).
```

```gdscript [Godot (GDScript)]
# server_combat.gd: one node at the same path on every peer (RPCs are matched by node path).
# Clients call request_fire.rpc_id(1, ...); only the server (peer 1) acts on them.
extends Node

enum Reject { NONE, ON_COOLDOWN, OUT_OF_RANGE, NO_LINE_OF_SIGHT, NOT_ENOUGH_GOLD, INVALID_TARGET }

## The server's own, authoritative state: player bodies named by peer id, prices, ...
@export var world: ServerWorld


@rpc("any_peer", "call_remote", "reliable")
func request_fire(target_id: int, weapon_slot: int) -> void:
	if not multiplayer.is_server():
		return
	# The sender comes from the connection, not from the arguments.
	var shooter_id := multiplayer.get_remote_sender_id()
	var result := _handle_fire(shooter_id, target_id, weapon_slot)
	if result != Reject.NONE:
		_rejected.rpc_id(shooter_id, result)


func _handle_fire(shooter_id: int, target_id: int, weapon_slot: int) -> Reject:
	# Never trust anything the client says about state: look it all up.
	var shooter := world.get_player(shooter_id)
	var target := world.get_player(target_id)
	if shooter == null or target == null or not shooter.is_alive() or not target.is_alive():
		return Reject.INVALID_TARGET
	if weapon_slot < 0 or weapon_slot >= shooter.weapons.size():
		return Reject.INVALID_TARGET

	var weapon: Weapon = shooter.weapons[weapon_slot]
	var now := world.time
	if now < weapon.ready_at:
		return Reject.ON_COOLDOWN

	var from := shooter.eye_position()
	var to := target.center_position()
	if from.distance_to(to) > weapon.max_range:
		return Reject.OUT_OF_RANGE
	var query := PhysicsRayQueryParameters3D.create(from, to)
	query.exclude = [shooter.get_rid(), target.get_rid()]
	if not world.get_world_3d().direct_space_state.intersect_ray(query).is_empty():
		return Reject.NO_LINE_OF_SIGHT

	# Only now does the shot happen, with the server's own damage numbers.
	weapon.ready_at = now + weapon.cooldown
	target.health -= weapon.damage  # health is in the player's MultiplayerSynchronizer: server writes, clients read
	_hit.rpc(shooter_id, target_id, weapon.damage)
	return Reject.NONE


# Movement: the client sends its input; the player body moves on the server's own physics tick.
@rpc("any_peer", "call_remote", "unreliable_ordered")
func send_move_input(move: Vector2) -> void:
	var player := world.get_player(multiplayer.get_remote_sender_id())
	if multiplayer.is_server() and player != null:
		player.move_input = move.limit_length(1.0)  # clamp tampered input; no client-supplied delta at all


# Economy: checked and applied on the server.
@rpc("any_peer", "call_remote", "reliable")
func request_buy(item_id: StringName) -> void:
	var buyer_id := multiplayer.get_remote_sender_id()
	var player := world.get_player(buyer_id)
	if player == null or not world.prices.has(item_id):
		_rejected.rpc_id(buyer_id, Reject.INVALID_TARGET)
	elif player.gold < world.prices[item_id]:
		_rejected.rpc_id(buyer_id, Reject.NOT_ENOUGH_GOLD)
	else:
		player.gold -= world.prices[item_id]
		player.inventory.add(item_id, 1)


@rpc("authority", "call_local", "reliable")
func _hit(_shooter_id: int, _target_id: int, _damage: float) -> void:
	pass  # every peer: play the hit effect


@rpc("authority", "call_remote", "reliable")
func _rejected(_reason: Reject) -> void:
	pass  # the requesting client: undo its prediction (refund ammo, play a "click")

# ServerWorld / ServerPlayer / Weapon: the server's simulation nodes and data (see the Unity tab).
```

```cpp [Unreal (C++)]
// CombatComponent.h: on the player's pawn. A Server RPC can only be called by the client that owns
// the actor, and it runs on the server's copy of this component.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "CombatComponent.generated.h"

UENUM()
enum class ERejectReason : uint8 { None, OnCooldown, OutOfRange, NoLineOfSight, NotEnoughGold, InvalidTarget };

USTRUCT()
struct FWeaponState
{
	GENERATED_BODY()

	UPROPERTY(EditDefaultsOnly) float Damage = 20.f;
	UPROPERTY(EditDefaultsOnly) float Range = 5000.f;      // cm
	UPROPERTY(EditDefaultsOnly) float Cooldown = 0.25f;
	double ReadyAt = 0.0;                                   // server time; never replicated
};

UCLASS(ClassGroup = (Game), meta = (BlueprintSpawnableComponent))
class UCombatComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UCombatComponent();

	// Client -> server: intentions only. The server looks up everything else itself.
	UFUNCTION(Server, Reliable)
	void ServerFire(AActor* TargetActor, int32 WeaponSlot);

	UFUNCTION(Server, Reliable)
	void ServerBuy(FName ItemId);

	// Written only on the server; replication sends the values to clients.
	UPROPERTY(ReplicatedUsing = OnRep_Health, BlueprintReadOnly)
	float Health = 100.f;

	UPROPERTY(Replicated, BlueprintReadOnly)
	int32 Gold = 0;

protected:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

private:
	ERejectReason HandleFire(AActor* TargetActor, int32 WeaponSlot);

	UFUNCTION(Client, Reliable)
	void ClientRejected(ERejectReason Reason);             // undo the prediction, play a "click"

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastHit(AActor* TargetActor, float Damage);   // cosmetic: effects on every machine

	UFUNCTION()
	void OnRep_Health();

	UPROPERTY(EditDefaultsOnly)
	TArray<FWeaponState> Weapons;

	UPROPERTY(EditDefaultsOnly)
	TMap<FName, int32> ShopPrices;                          // the server's price list, never the client's
};

// CombatComponent.cpp
#include "CombatComponent.h"
#include "Net/UnrealNetwork.h"

UCombatComponent::UCombatComponent()
{
	SetIsReplicatedByDefault(true);
}

void UCombatComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(UCombatComponent, Health);
	DOREPLIFETIME_CONDITION(UCombatComponent, Gold, COND_OwnerOnly);
}

void UCombatComponent::ServerFire_Implementation(AActor* TargetActor, int32 WeaponSlot)
{
	const ERejectReason Result = HandleFire(TargetActor, WeaponSlot);
	if (Result != ERejectReason::None) ClientRejected(Result);
}

ERejectReason UCombatComponent::HandleFire(AActor* TargetActor, int32 WeaponSlot)
{
	// Never trust anything the client says about state: look it all up.
	UCombatComponent* Target = TargetActor ? TargetActor->FindComponentByClass<UCombatComponent>() : nullptr;
	if (Health <= 0.f || !Target || Target == this || Target->Health <= 0.f) return ERejectReason::InvalidTarget;
	if (!Weapons.IsValidIndex(WeaponSlot)) return ERejectReason::InvalidTarget;

	FWeaponState& Weapon = Weapons[WeaponSlot];
	const double Now = GetWorld()->GetTimeSeconds();
	if (Now < Weapon.ReadyAt) return ERejectReason::OnCooldown;

	FVector From;
	FRotator EyeRotation;
	GetOwner()->GetActorEyesViewPoint(From, EyeRotation);
	const FVector To = TargetActor->GetActorLocation();
	if (FVector::Dist(From, To) > Weapon.Range) return ERejectReason::OutOfRange;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(ServerFire), false, GetOwner());
	Params.AddIgnoredActor(TargetActor);
	FHitResult Hit;
	if (GetWorld()->LineTraceSingleByChannel(Hit, From, To, ECC_Visibility, Params)) return ERejectReason::NoLineOfSight;

	// Only now does the shot happen, with the server's own damage numbers.
	Weapon.ReadyAt = Now + Weapon.Cooldown;
	Target->Health -= Weapon.Damage;
	Target->OnRep_Health();                                 // OnRep doesn't fire on the server (or a listen host)
	MulticastHit(TargetActor, Weapon.Damage);
	return ERejectReason::None;
}

void UCombatComponent::ServerBuy_Implementation(FName ItemId)
{
	const int32* Price = ShopPrices.Find(ItemId);
	if (!Price) { ClientRejected(ERejectReason::InvalidTarget); return; }
	if (Gold < *Price) { ClientRejected(ERejectReason::NotEnoughGold); return; }
	Gold -= *Price;
	// GiveItem(ItemId): also server-side; the inventory replicates to the owner.
}

void UCombatComponent::ClientRejected_Implementation(ERejectReason Reason) { /* refund predicted ammo, click */ }
void UCombatComponent::MulticastHit_Implementation(AActor* TargetActor, float Damage) { /* hit effects */ }
void UCombatComponent::OnRep_Health() { /* update the health bar, play hurt effects */ }
```

:::

Rejected requests are normal, because latency makes honest clients occasionally ask for impossible things. Send the reason back so the client can correct its prediction (refund the predicted ammo, play a "click").

**Engine notes**

- **Unity:** In **Netcode for GameObjects**, the same idea appears as server RPCs (`[Rpc(SendTo.Server)]` in NGO 1.8+, `[ServerRpc]` before that), whose `RpcParams` tell you the sender, with `NetworkVariable`s that only the server writes. **Netcode for Entities** is server-authoritative with prediction built in. Run the server as a headless *Dedicated Server* build target.
- **Godot:** The high-level multiplayer API (`ENetMultiplayerPeer`, `@rpc`) has the server as peer 1 and the authority of every node by default. `multiplayer.get_remote_sender_id()` is the trustworthy sender. Put server-written state such as `health` in a `MultiplayerSynchronizer` and keep the node's authority on the server, or clients can write it. Godot can export a dedicated server with `--headless`.
- **Unreal:** Unreal is server-authoritative by design. `Replicated` properties flow server → client only, and `Server` RPCs are the only client → server path. Add `WithValidation` and a `_Validate` function only for values no honest client can send: returning false **disconnects** the client, so ordinary rejections (cooldowns, range) belong in `_Implementation`. Character movement is already authoritative: `UCharacterMovementComponent` sends moves, simulates them on the server and corrects the client, so don't replicate positions yourself.

## When to use

- Any competitive multiplayer game, and any game with an economy, progression or leaderboards that cheating would spoil.
- Games with many players, where peer-to-peer trust and bandwidth do not scale.

## When not to use

- Co-op games among friends with nothing to gain from cheating. Host-authoritative or peer-to-peer is cheaper to build and run.
- Games where server costs outweigh the benefit, such as small indie co-op titles. Dedicated servers cost money for as long as the game is live.
- Fighting games and other small-player-count games with tight timing. [Rollback Netcode](./rollback-netcode) usually feels better.

## Pitfalls

- **Trusting client state "just for this one thing".** Client-reported positions, hit results, timestamps or inventory are the classic exploits. Treat every client message as a request that can be a lie.
- **Unbounded inputs.** A client can send 1,000 inputs per second, or a movement vector of length 100. Clamp, rate-limit and validate inputs as well as actions.
- **Latency without hiding it.** Pure server authority with no prediction feels unplayable above about 50 ms. Combine with prediction and interpolation from the start.
- **Host advantage.** On a listen server, the host has no latency and full access to server state. For competitive play, use dedicated servers.
- **Server cost and code split.** The server needs headless builds, hosting and scaling. Keep simulation code free of rendering and UI, so it runs on the server unchanged.

## Related

- [Client-Side Prediction](./client-side-prediction), [Server Reconciliation](./server-reconciliation), [Entity Interpolation](./entity-interpolation) and [Lag Compensation](./lag-compensation) — hiding latency on top of authority.
- [Snapshot & Delta Compression](./snapshot-delta-compression) — sending state efficiently.
- [Interest Management](./interest-management) — sending only relevant state, which also limits what cheaters can see.
- [Command](./command) — client requests are commands, validated before execution.
- [Responsive Online Movement](../recipes/responsive-online-movement) — the full movement stack built on an authoritative server.
