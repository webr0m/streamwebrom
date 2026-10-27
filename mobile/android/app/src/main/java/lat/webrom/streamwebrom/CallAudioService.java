package lat.webrom.streamwebrom;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** User-enabled support for an ongoing WebView audio call; never records audio itself. */
public final class CallAudioService extends Service {
    static volatile boolean running;
    static final String STOP = "lat.webrom.streamwebrom.STOP_BACKGROUND_AUDIO";
    private static final String CHANNEL = "room-audio";

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if ((intent != null && STOP.equals(intent.getAction())) ||
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Audio de la sala", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantiene StreamWebRom disponible al usar otras aplicaciones.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        Intent back = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 0, back, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, CallAudioService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("StreamWebRom en segundo plano")
                .setContentText("Toca para volver a la sala. Android puede pausar la cámara.")
                .setContentIntent(open).setOngoing(true).setCategory(Notification.CATEGORY_CALL)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Desactivar segundo plano", stop).build()).build();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(114, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(114, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(114, notification);
            }
            running = true;
        } catch (SecurityException e) {
            stopSelf();
        }
        return START_NOT_STICKY; // Never restart microphone support after a process kill or reboot.
    }

    @Override public void onDestroy() { running = false; super.onDestroy(); }
    @Override public void onTaskRemoved(Intent rootIntent) { stopSelf(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
