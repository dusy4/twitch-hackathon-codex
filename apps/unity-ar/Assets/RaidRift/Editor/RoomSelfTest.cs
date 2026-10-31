using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;

namespace RaidRift.EditorTools
{
    /// <summary>Headless check that heroes can reach furniture: bakes a stand-in room (floor, 45 cm bed,
    /// 72 cm desk, 30 cm step) with the app's own RoomNavigation settings and jump-link builder, then asks
    /// for paths from the floor onto each surface. Unity.exe -batchmode -executeMethod RaidRift.EditorTools.RoomSelfTest.Run</summary>
    public static class RoomSelfTest
    {
        public static void Run()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cam = new GameObject("Phone").transform;
            cam.position = new Vector3(0f, 1.3f, -1.2f);
            var nav = new GameObject("Nav").AddComponent<RoomNavigation>();
            nav.cameraTransform = cam;
            var sources = new List<NavMeshBuildSource>();
            void Box(Vector3 center, Vector3 size) => sources.Add(new NavMeshBuildSource
            {
                shape = NavMeshBuildSourceShape.Box, size = size, transform = Matrix4x4.Translate(center), area = 0
            });
            Box(new Vector3(0f, -0.05f, 0f), new Vector3(6f, 0.1f, 6f));          // floor
            Box(new Vector3(1.6f, 0.225f, 0.3f), new Vector3(1.0f, 0.45f, 2.0f));  // bed (45 cm)
            Box(new Vector3(-1.4f, 0.15f, 0.8f), new Vector3(0.5f, 0.3f, 0.5f));   // ottoman (30 cm)
            Box(new Vector3(-1.5f, 0.71f, -1.2f), new Vector3(1.0f, 0.04f, 0.6f)); // desk top (72 cm, no legs: unreachable is fine)
            int links = nav.TestBake(sources, new Bounds(new Vector3(0f, 0.5f, 0f), new Vector3(8f, 3f, 8f)), 0f);
            var path = new NavMeshPath();
            bool Check(string name, Vector3 from, Vector3 to, bool expect)
            {
                bool ok = nav.Sample(to, 0.3f, out var target) && nav.Reachable(from, target, path);
                Debug.Log($"[RaidRift] selftest {name}: reachable={ok} corners={path.corners.Length} expected={expect} {(ok == expect ? "PASS" : "FAIL")}");
                return ok == expect;
            }
            Debug.Log($"[RaidRift] selftest links={links} tops={nav.Tops.Count}");
            bool pass = links > 0;
            pass &= Check("floor->bed top", new Vector3(0f, 0f, -0.5f), new Vector3(1.6f, 0.45f, 0.3f), true);
            pass &= Check("bed top->floor", new Vector3(1.6f, 0.45f, 0.3f), new Vector3(-0.5f, 0f, -0.5f), true);
            pass &= Check("floor->ottoman", new Vector3(0f, 0f, -0.5f), new Vector3(-1.4f, 0.3f, 0.8f), true);
            pass &= FloorTest(nav);
            pass &= LabelTest(nav, cam);
            Debug.Log("[RaidRift] selftest " + (pass ? "ALL PASS" : "FAILED"));
            if (Application.isBatchMode) EditorApplication.Exit(pass ? 0 : 2);
        }

        // ---------------- G1: floor estimate is the floor, stable, not noise or a bed ----------------
        static NavMeshTriangulation Quads(params (Vector3 center, float w, float d)[] quads)
        {
            var v = new List<Vector3>();
            var idx = new List<int>();
            foreach (var (c, w, d) in quads)
            {
                int i = v.Count;
                v.Add(c + new Vector3(-w / 2, 0, -d / 2)); v.Add(c + new Vector3(-w / 2, 0, d / 2));
                v.Add(c + new Vector3(w / 2, 0, d / 2)); v.Add(c + new Vector3(w / 2, 0, -d / 2));
                idx.AddRange(new[] { i, i + 1, i + 2, i, i + 2, i + 3 });
            }
            return new NavMeshTriangulation { vertices = v.ToArray(), indices = idx.ToArray(), areas = new int[idx.Count / 3] };
        }

        static bool FloorTest(RoomNavigation nav)
        {
            bool ok = true;
            var room = Quads((new Vector3(0, 0f, 0), 4f, 4f), (new Vector3(1.6f, 0.45f, 0.3f), 1f, 2f), (new Vector3(-1f, -0.4f, 1f), 0.2f, 0.2f), (new Vector3(0.5f, -0.25f, -1f), 0.15f, 0.15f));
            float? f = null;
            for (int i = 0; i < 4; i++) f = nav.TestFloor(room);
            bool a = f.HasValue && Mathf.Abs(f.Value) < 0.03f;
            Debug.Log($"[RaidRift] selftest floor with bed + noise specks: {f:0.000} m {(a ? "PASS" : "FAIL")}"); ok &= a;
            // One noisy bake where a big phantom patch appears 40 cm lower must not move the floor (hysteresis).
            var noisy = Quads((new Vector3(0, 0f, 0), 4f, 4f), (new Vector3(0, -0.4f, 2.5f), 3f, 3f));
            f = nav.TestFloor(noisy);
            f = nav.TestFloor(room);
            bool b = f.HasValue && Mathf.Abs(f.Value) < 0.03f;
            Debug.Log($"[RaidRift] selftest floor after one phantom bake: {f:0.000} m {(b ? "PASS" : "FAIL")}"); ok &= b;
            // Small visible floor next to a big bed: still the floor (lowest substantial band).
            var bedHeavy = Quads((new Vector3(0, 0f, -1f), 1.2f, 1f), (new Vector3(1.6f, 0.45f, 0.3f), 1.6f, 2f));
            for (int i = 0; i < 4; i++) f = nav.TestFloor(bedHeavy);
            bool c = f.HasValue && Mathf.Abs(f.Value) < 0.03f;
            Debug.Log($"[RaidRift] selftest floor with little floor visible beside a big bed: {f:0.000} m {(c ? "PASS" : "FAIL")}"); ok &= c;
            return ok;
        }

        // ---------------- G3: detections become labelled 3D surfaces ----------------
        static Rect ViewportBox(Camera cam, Bounds b)
        {
            float x0 = 1, y0 = 1, x1 = 0, y1 = 0;
            for (int i = 0; i < 8; i++)
            {
                var p = new Vector3((i & 1) == 0 ? b.min.x : b.max.x, (i & 2) == 0 ? b.min.y : b.max.y, (i & 4) == 0 ? b.min.z : b.max.z);
                var v = cam.WorldToViewportPoint(p);
                x0 = Mathf.Min(x0, v.x); y0 = Mathf.Min(y0, v.y); x1 = Mathf.Max(x1, v.x); y1 = Mathf.Max(y1, v.y);
            }
            return Rect.MinMaxRect(Mathf.Clamp01(x0), Mathf.Clamp01(y0), Mathf.Clamp01(x1), Mathf.Clamp01(y1));
        }

        static bool LabelTest(RoomNavigation nav, Transform phone)
        {
            var camGo = new GameObject("TestCam");
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 65f; cam.aspect = 1080f / 2340f;
            camGo.transform.position = new Vector3(0f, 1.3f, -1.6f);
            camGo.transform.LookAt(new Vector3(0.2f, 0.2f, 0.4f));
            var labels = new GameObject("Labels").AddComponent<SurfaceLabels>();
            labels.room = nav;
            // The streamer points the phone at each thing (portrait FOV is only ~32° wide), from a few spots.
            var things = new[]
            {
                ("bed", 0.9f, new Bounds(new Vector3(1.6f, 0.225f, 0.3f), new Vector3(1f, 0.45f, 2f))),
                ("chair", 0.8f, new Bounds(new Vector3(-1.4f, 0.15f, 0.8f), new Vector3(0.5f, 0.3f, 0.5f))),
                ("dog", 0.85f, new Bounds(new Vector3(0.4f, 0.2f, 0.2f), new Vector3(0.5f, 0.4f, 0.2f))),
            };
            var eyes = new[] { new Vector3(0f, 1.3f, -1.6f), new Vector3(0.4f, 1.4f, -1.4f), new Vector3(-0.3f, 1.25f, -1.5f) };
            float now = 0f;
            foreach (var eye in eyes)
                foreach (var (label, score, bounds) in things)
                {
                    camGo.transform.position = eye;
                    camGo.transform.LookAt(bounds.center);
                    var d = new List<Detection> { new Detection { label = label, score = score, viewport = ViewportBox(cam, bounds) } };
                    labels.Ingest(d, cam.cameraToWorldMatrix, cam.projectionMatrix, now += 0.4f);
                }
            bool ok = true;
            bool Check(string label, Vector3 expect, bool raised, float tol)
            {
                var t = labels.Things.Find(x => x.label == label);
                bool pass = t != null && t.raised == raised && Vector3.Distance(t.pos, expect) < tol;
                Debug.Log($"[RaidRift] selftest label {label}: {(t == null ? "missing" : $"{t.pos} raised={t.raised} conf={t.confidence:0.00} n={t.sightings}")} expected ~{expect} raised={raised} {(pass ? "PASS" : "FAIL")}");
                return pass;
            }
            ok &= Check("bed", new Vector3(1.6f, 0.45f, 0.3f), true, 0.8f);
            ok &= Check("chair", new Vector3(-1.4f, 0.3f, 0.8f), true, 0.35f);
            ok &= Check("dog", new Vector3(0.4f, 0f, 0.2f), false, 0.3f);
            bool bedY = labels.Things.Exists(x => x.label == "bed" && Mathf.Abs(x.pos.y - 0.45f) < 0.05f);
            Debug.Log($"[RaidRift] selftest bed top height within 5 cm: {(bedY ? "PASS" : "FAIL")}");
            return ok && bedY;
        }
    }
}
