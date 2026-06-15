FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css script.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY screenshots/ /usr/share/nginx/html/screenshots/

EXPOSE 80
