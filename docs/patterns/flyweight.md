# Flyweight

> Share the heavy, unchanging data between many instances.

**Category:** Performance & Memory

## Problem

A forest has 10,000 trees. Each one has a position, rotation, scale and tint, plus a mesh, materials, bark sound set, burn time and wood yield. If every tree stores its own copy of everything, almost all of that memory duplicates data that is identical for every oak.

## Solution

Split each object's data into two parts:

- **Intrinsic** state is shared and immutable, such as the mesh, the material and the gameplay stats of the "oak" type. It is stored once.
- **Extrinsic** state is unique per instance, such as position, current health or the burning flag. It is stored per object, together with a *reference* to the shared intrinsic data.

## Example (Unity C#)

ScriptableObjects are a natural flyweight. Store the shared definition as an asset, and let each instance hold only its own state plus a reference to the asset:

```csharp
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

The same idea applies at the GPU level. GPU instancing draws thousands of copies of one mesh and material in a single call, with per-instance transforms:

```csharp
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

## When to use

- Many objects share most of their data: tiles, trees, bullets, items, particles.
- Item and unit definitions in data-driven games (`ItemDefinition` versus `ItemInstance`).

## Pitfalls

- **Accidentally mutating shared data.** Changing `type.woodYield` at runtime changes it for every tree. In the editor, it also persists into the asset. Treat flyweights as read-only.
- **`renderer.material` (not `sharedMaterial`)** silently clones the material per object and breaks sharing and batching.
- Use flyweights only when the duplication actually costs memory or bandwidth. Splitting the data adds indirection.

## Related

- [Object Pool](./object-pool) — reuses instances. A flyweight shares data between them.
- [Type Object](./type-object) — uses shared definitions to create new *kinds* of things as data.
