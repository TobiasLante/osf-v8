FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY chat.html /usr/share/nginx/html/index.html
COPY chat.html /usr/share/nginx/html/chat.html
COPY analysis.html /usr/share/nginx/html/analysis.html
COPY css/ /usr/share/nginx/html/css/
# Run as nginx user (UID 101) instead of root
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx
EXPOSE 8080
