# Flyweight

> Share the heavy, unchanging data between many instances.

**Category:** Performance & Memory

## Problem

A forest has 10,000 trees. Each one has a position, rotation, scale and tint, plus a mesh, materials, bark sound set, burn time and wood yield. If every tree stores its own copy of everything, almost all of that memory duplicates data that is identical for every oak.

## Solution

Split each object's data into two parts:

- **Intrinsic** state is shared and immutable, such as the mesh, the material and the gameplay stats of the "oak" type. It is stored once.
- **Extrinsic** state is unique per instance, such as position, current health or the burning flag. It is stored per object, together with a *reference* to the shared intrinsic data.

## Pseudocode

```text
// Intrinsic: one per kind of tree, shared and read-only.
TreeType:
    mesh, material
    wood_yield
    burn_time

// Extrinsic: one per tree, small.
TreeInstance:
    type          // a reference to a TreeType, never a copy
    position
    health

oak  ← load TreeType "oak"     // stored once
pine ← load TreeType "pine"

for each placed tree:
    add TreeInstance(type ← oak or pine, position, full health) to forest

// Reading shared data goes through the reference.
chop(tree):
    give player tree.type.wood_yield wood

// The GPU version: one mesh and material, one transform per instance.
draw_forest(type):
    transforms ← position of every tree whose type is this type
    draw type.mesh with type.material once for all transforms
```

## Example

Each engine has an asset type that works as a flyweight: Unity ScriptableObjects, Godot Resources and Unreal Data Assets. Store the shared definition as an asset, and let each instance hold only its own state plus a reference to the asset:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

[CreateAssetMenu(menuName = "World/Tree Type")]
public class TreeType : ScriptableObject          // intrinsic, shared
{
    public Mesh mesh;
    public Material material;
    public int woodYield = 5;
    public float burnTime = 8f;
}

public struct TreeInstance                        // extrinsic, per tree
{
    public TreeType type;
    public Vector3 position;
    public float health;
}
```

```gdscript [Godot (GDScript)]
# tree_type.gd: intrinsic, shared. Save one .tres per type (oak.tres, pine.tres).
class_name TreeType
extends Resource

@export var mesh: Mesh
@export var material: Material
@export var wood_yield := 5
@export var burn_time := 8.0


# tree_instance.gd: extrinsic, per tree. Every oak points at the same oak.tres.
# (Not named "Tree": Godot already has a Tree control.)
class_name TreeInstance
extends RefCounted

var type: TreeType
var position: Vector3
var health: float
```

```cpp [Unreal (C++)]
// TreeType.h
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "TreeType.generated.h"

UCLASS(BlueprintType)
class UTreeType : public UPrimaryDataAsset          // intrinsic, shared
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly)
	TObjectPtr<UStaticMesh> Mesh;

	UPROPERTY(EditDefaultsOnly)
	TObjectPtr<UMaterialInterface> Material;

	UPROPERTY(EditDefaultsOnly)
	int32 WoodYield = 5;

	UPROPERTY(EditDefaultsOnly)
	float BurnTime = 8.f;
};

USTRUCT(BlueprintType)
struct FTreeInstance                                // extrinsic, per tree
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere)
	TObjectPtr<UTreeType> Type = nullptr;

	UPROPERTY(EditAnywhere)
	FVector Position = FVector::ZeroVector;

	UPROPERTY(EditAnywhere)
	float Health = 100.f;
};
```

:::

The same idea applies at the GPU level. Instancing draws thousands of copies of one mesh and material in a single call, with only a transform per instance:

::: code-group

```csharp [Unity (C#)]
using UnityEngine;

public class ForestRenderer : MonoBehaviour
{
    [SerializeField] TreeType type;
    Matrix4x4[] matrices;   // extrinsic: one transform per tree
    RenderParams rp;

    void Start()
    {
        rp = new RenderParams(type.material);   // material needs "Enable GPU Instancing"
        matrices = new Matrix4x4[1000];
        for (int i = 0; i < matrices.Length; i++)
            matrices[i] = Matrix4x4.TRS(Random.insideUnitSphere * 100f, Quaternion.identity, Vector3.one);
    }

    void Update() => Graphics.RenderMeshInstanced(rp, type.mesh, 0, matrices);
}
```

```gdscript [Godot (GDScript)]
# forest.gd: one MultiMesh, one draw call for every tree of this type.
extends MultiMeshInstance3D

@export var type: TreeType
@export var count := 1000


func _ready() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D  # must be set while instance_count is 0
	mm.mesh = type.mesh
	mm.instance_count = count
	for i in count:
		var pos := Vector3(randf_range(-100.0, 100.0), 0.0, randf_range(-100.0, 100.0))
		mm.set_instance_transform(i, Transform3D(Basis(), pos))  # extrinsic: one transform per tree
	multimesh = mm
	material_override = type.material
```

```cpp [Unreal (C++)]
// Forest.h: UPROPERTY(EditAnywhere) TObjectPtr<UTreeType> Type;  UPROPERTY(EditAnywhere) int32 Count = 1000;
//           UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Instances;

// Forest.cpp
#include "Forest.h"
#include "Components/InstancedStaticMeshComponent.h"

AForest::AForest()
{
	Instances = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Instances"));
	RootComponent = Instances;
}

void AForest::BeginPlay()
{
	Super::BeginPlay();
	Instances->SetStaticMesh(Type->Mesh);
	Instances->SetMaterial(0, Type->Material);

	TArray<FTransform> Transforms;                  // extrinsic: one transform per tree
	Transforms.Reserve(Count);
	for (int32 i = 0; i < Count; ++i)
		Transforms.Emplace(FVector(FMath::FRandRange(-10000.f, 10000.f), FMath::FRandRange(-10000.f, 10000.f), 0.f));
	Instances->AddInstances(Transforms, /*bShouldReturnIndices*/ false);
}
```

:::

**Engine notes**

- **Unity:** ScriptableObjects are shared by reference, so changing one at runtime changes every tree of that type, and in the editor the change is saved to the asset. `Graphics.RenderMeshInstanced` is Unity 2022.1+; the Terrain's tree and detail systems already instance for you.
- **Godot:** a Resource loaded from the same path is one shared object, which is exactly the flyweight. Tick **Local to Scene** (or `duplicate()`) only when an instance really needs its own copy. `MultiMeshInstance3D` draws all instances with one material and one visibility test, so very large forests should be split into several MultiMeshes so that off-screen parts can be culled.
- **Unreal:** Data Assets are shared the same way; mark them `UPrimaryDataAsset` to load them through the Asset Manager. The **Foliage** tool places trees as Hierarchical Instanced Static Meshes for you, and with Nanite enabled the per-instance cost drops further.

## When to use

- Many objects share most of their data: tiles, trees, bullets, items, particles.
- Item and unit definitions in data-driven games (`ItemDefinition` versus `ItemInstance`).

## When not to use

- A few objects. Sharing data saves nothing worth the split.
- Data that differs per instance. Forcing it into shared definitions leads to many near-duplicate definitions.
- When shared definitions are edited at runtime. Every instance changes at once; copy the data first.

## Pitfalls

- **Accidentally mutating shared data.** Changing `type.woodYield` at runtime changes it for every tree. In the editor, it also persists into the asset. Treat flyweights as read-only.
- **`renderer.material` (not `sharedMaterial`)** silently clones the material per object and breaks sharing and batching.
- Use flyweights only when the duplication actually costs memory or bandwidth. Splitting the data adds indirection.

## Related

- [Object Pool](./object-pool) — reuses instances. A flyweight shares data between them.
- [Type Object](./type-object) — uses shared definitions to create new *kinds* of things as data.
- [Proxy](./proxy) — controls access to one heavy object (often loading it lazily). A flyweight shares one between many users.
