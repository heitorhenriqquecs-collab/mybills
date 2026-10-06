package com.mybills.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "LocalTransfer")
public class LocalTransferPlugin extends Plugin {
    private static final int DISCOVERY_PORT = 43128;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void discover(PluginCall call) {
        String code = call.getString("code", "").replaceAll("\\D", "");
        if (!code.matches("\\d{6}")) {
            call.reject("Digite o código de seis números.");
            return;
        }
        executor.execute(() -> discoverComputer(call, code));
    }

    private void discoverComputer(PluginCall call, String code) {
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            socket.setSoTimeout(700);
            byte[] query = ("MYBILLS_DISCOVER:" + code).getBytes(StandardCharsets.UTF_8);
            Set<InetAddress> broadcasts = new LinkedHashSet<>();
            broadcasts.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress address : network.getInterfaceAddresses()) {
                    if (address.getAddress() instanceof Inet4Address && address.getBroadcast() != null) broadcasts.add(address.getBroadcast());
                }
            }
            long deadline = System.currentTimeMillis() + 6000;
            byte[] buffer = new byte[2048];
            while (System.currentTimeMillis() < deadline) {
                for (InetAddress address : broadcasts) socket.send(new DatagramPacket(query, query.length, address, DISCOVERY_PORT));
                try {
                    DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                    socket.receive(response);
                    JSONObject value = new JSONObject(new String(response.getData(), response.getOffset(), response.getLength(), StandardCharsets.UTF_8));
                    if (!"mybills-local-transfer".equals(value.optString("kind")) || !"send".equals(value.optString("direction"))) continue;
                    JSObject result = new JSObject();
                    result.put("host", response.getAddress().getHostAddress());
                    result.put("port", value.getInt("port"));
                    result.put("token", value.getString("token"));
                    result.put("expiresAt", value.optLong("expiresAt"));
                    call.resolve(result);
                    return;
                } catch (java.net.SocketTimeoutException ignored) {}
            }
            call.reject("Computador não encontrado. Confirme o código e a mesma rede Wi-Fi.");
        } catch (Exception error) {
            call.reject("Não foi possível procurar o computador na rede local.", error);
        }
    }
}
