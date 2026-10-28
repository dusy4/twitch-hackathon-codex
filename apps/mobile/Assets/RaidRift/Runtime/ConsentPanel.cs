using UnityEngine;
namespace RaidRift {
 public sealed class ConsentPanel:MonoBehaviour {
  public ArWorld world;public CompositePublisher publisher;Rect panel;
  void OnGUI(){GUI.skin.label.fontSize=Mathf.Max(16,Screen.width/45);GUI.skin.button.fontSize=GUI.skin.label.fontSize;GUI.skin.textField.fontSize=GUI.skin.label.fontSize;panel=new Rect(15,15,Screen.width-30,Screen.height*.32f);GUILayout.BeginArea(panel,GUI.skin.box);GUILayout.Label("RAIDRIFT • NATIVE AR / UNVALIDATED BUILD");GUILayout.Label(world.Status);world.server=GUILayout.TextField(world.server);world.token=GUILayout.PasswordField(world.token,'•');GUILayout.BeginHorizontal();if(GUILayout.Button("Consent: enable camera"))StartCoroutine(world.EnableCapture());if(GUILayout.Button("Share composed video to OBS"))publisher.BeginPublishing();if(GUILayout.Button("STOP CAMERA & STREAM"))world.StopCapture();GUILayout.EndHorizontal();GUILayout.Label(publisher.Status+" • audio transmission unavailable");GUILayout.EndArea();}
 }
}
